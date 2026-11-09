//! BGRA → NV12 na placa (D3D11 Video Processor) e H.264 pelo Media Foundation.
//!
//! O codificador da placa (NVIDIA, AMD ou Intel) vem com o driver e aparece
//! como um MFT de hardware; não há SDK para instalar nem DLL para levar. Sem
//! ele, o codificador H.264 de software do próprio Windows.
//!
//! Ajustes de baixa latência (os do Sunshine, no que o MFT deixa): modo de
//! baixa latência, CBR, sem quadros B, buffer de um quadro e quadro-chave só
//! quando pedido (o GOP de 60 s é rede de segurança).

use std::mem::ManuallyDrop;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use windows::Win32::Foundation::{LUID, VARIANT_BOOL};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4};
use windows::core::{GUID, Interface, Result};

use crate::captura::Placa;

/// Um quadro H.264 pronto (Annex-B, com SPS/PPS antes de todo quadro-chave).
pub struct Codificado {
    pub dados: Vec<u8>,
    pub chave: bool,
    /// O tempo da amostra (QPC, 100 ns): o instante da captura.
    pub tempo: i64,
}

/// Tudo o que acorda o laço principal chega por um canal só.
pub enum Evento {
    Capturou,
    Precisa,
    Saiu(Codificado),
    Comando(crate::Comando),
    Falhou(String),
}

/* ------------------------------------------------------------------ *
 * Conversor
 * ------------------------------------------------------------------ */

/// Quantas texturas NV12 giram entre o conversor e o codificador. O MFT
/// assíncrono segura algumas enquanto codifica; 6 dá folga sem gastar memória.
const ANEL: usize = 6;

pub struct Conversor {
    contexto: ID3D11DeviceContext,
    device: ID3D11Device,
    vctx: ID3D11VideoContext,
    vp: ID3D11VideoProcessor,
    copia: ID3D11Texture2D,
    copia_tam: (u32, u32),
    copia_vista: ID3D11VideoProcessorInputView,
    anel: Vec<(ID3D11Texture2D, ID3D11VideoProcessorOutputView)>,
    proxima: usize,
    saida: (u32, u32),
    leitura: Option<ID3D11Texture2D>,
}

fn textura(device: &ID3D11Device, (w, h): (u32, u32), formato: DXGI_FORMAT, bind: u32, uso: D3D11_USAGE, cpu: u32) -> Result<ID3D11Texture2D> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: w,
        Height: h,
        MipLevels: 1,
        ArraySize: 1,
        Format: formato,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: uso,
        BindFlags: bind,
        CPUAccessFlags: cpu,
        MiscFlags: 0,
    };
    let mut t = None;
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut t))? };
    Ok(t.unwrap())
}

impl Conversor {
    pub fn novo(placa: &Placa, entrada: (u32, u32), saida: (u32, u32), qps: u32) -> Result<Conversor> {
        let vdev: ID3D11VideoDevice = placa.device.cast()?;
        let vctx: ID3D11VideoContext = placa.contexto.cast()?;
        let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL { Numerator: qps, Denominator: 1 },
            InputWidth: entrada.0,
            InputHeight: entrada.1,
            OutputFrameRate: DXGI_RATIONAL { Numerator: qps, Denominator: 1 },
            OutputWidth: saida.0,
            OutputHeight: saida.1,
            Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
        };
        let enumerador = unsafe { vdev.CreateVideoProcessorEnumerator(&desc)? };
        let vp = unsafe { vdev.CreateVideoProcessor(&enumerador, 0)? };
        // Campo de bits D3D11_VIDEO_PROCESSOR_COLOR_SPACE: Usage (bit 0),
        // RGB_Range (1), YCbCr_Matrix (2: 1 = BT.709), Nominal_Range (4-5).
        // Saída: BT.709, 16-235. Entrada: RGB 0-255.
        unsafe {
            vctx.VideoProcessorSetOutputColorSpace(&vp, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 1 | 4 | (1 << 4) });
            vctx.VideoProcessorSetStreamColorSpace(&vp, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 1 | (2 << 4) });
            // Sem isto alguns drivers "melhoram" a imagem e gastam tempo.
            vctx.VideoProcessorSetStreamAutoProcessingMode(&vp, 0, false);
        }

        let bind_rt = D3D11_BIND_RENDER_TARGET.0 as u32;
        let copia = textura(&placa.device, entrada, DXGI_FORMAT_B8G8R8A8_UNORM, bind_rt | D3D11_BIND_SHADER_RESOURCE.0 as u32, D3D11_USAGE_DEFAULT, 0)?;
        let copia_vista = vista_entrada(&vdev, &enumerador, &copia)?;
        let mut anel = Vec::with_capacity(ANEL);
        for _ in 0..ANEL {
            let t = textura(&placa.device, saida, DXGI_FORMAT_NV12, bind_rt | D3D11_BIND_VIDEO_ENCODER.0 as u32, D3D11_USAGE_DEFAULT, 0)?;
            let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } },
            };
            let mut v = None;
            unsafe { vdev.CreateVideoProcessorOutputView(&t, &enumerador, &desc, Some(&mut v))? };
            anel.push((t, v.unwrap()));
        }
        Ok(Conversor {
            contexto: placa.contexto.clone(),
            device: placa.device.clone(),
            vctx,
            vp,
            copia,
            copia_tam: entrada,
            copia_vista,
            anel,
            proxima: 0,
            saida,
            leitura: None,
        })
    }

    /// Converte o quadro capturado numa das texturas NV12 do anel e a devolve.
    pub fn converter(&mut self, bgra: &ID3D11Texture2D) -> Result<ID3D11Texture2D> {
        unsafe {
            let mut d = D3D11_TEXTURE2D_DESC::default();
            bgra.GetDesc(&mut d);
            if (d.Width, d.Height) == self.copia_tam {
                self.contexto.CopyResource(&self.copia, bgra);
            } else {
                // ponytail: janela redimensionada é cortada (ou sobra preto) no
                // tamanho do começo; refazer conversor e codificador no tamanho
                // novo quando isso incomodar.
                let caixa = D3D11_BOX { left: 0, top: 0, front: 0, right: d.Width.min(self.copia_tam.0), bottom: d.Height.min(self.copia_tam.1), back: 1 };
                self.contexto.CopySubresourceRegion(&self.copia, 0, 0, 0, 0, bgra, 0, Some(&caixa));
            }
            let (t, vista) = &self.anel[self.proxima];
            self.proxima = (self.proxima + 1) % ANEL;
            let fluxo = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: ManuallyDrop::new(Some(self.copia_vista.clone())),
                ..Default::default()
            };
            let r = self.vctx.VideoProcessorBlt(&self.vp, vista, 0, &[fluxo]);
            r?;
            Ok(t.clone())
        }
    }

    /// Copia a NV12 para a memória (só para o codificador de software).
    pub fn ler_nv12(&mut self, nv12: &ID3D11Texture2D) -> Result<Vec<u8>> {
        let (w, h) = self.saida;
        if self.leitura.is_none() {
            self.leitura = Some(textura(&self.device, self.saida, DXGI_FORMAT_NV12, 0, D3D11_USAGE_STAGING, D3D11_CPU_ACCESS_READ.0 as u32)?);
        }
        let leitura = self.leitura.as_ref().unwrap();
        let (w, h) = (w as usize, h as usize);
        let mut dados = vec![0u8; w * h * 3 / 2];
        unsafe {
            self.contexto.CopyResource(leitura, nv12);
            let mut m = D3D11_MAPPED_SUBRESOURCE::default();
            self.contexto.Map(leitura, 0, D3D11_MAP_READ, 0, Some(&mut m))?;
            let passo = m.RowPitch as usize;
            let base = m.pData as *const u8;
            // Plano Y (h linhas) e logo depois o UV (h/2 linhas), no mesmo passo.
            for y in 0..h + h / 2 {
                let origem = std::slice::from_raw_parts(base.add(y * passo), w);
                dados[y * w..(y + 1) * w].copy_from_slice(origem);
            }
            self.contexto.Unmap(leitura, 0);
        }
        Ok(dados)
    }
}

fn vista_entrada(vdev: &ID3D11VideoDevice, e: &ID3D11VideoProcessorEnumerator, t: &ID3D11Texture2D) -> Result<ID3D11VideoProcessorInputView> {
    let desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
        FourCC: 0,
        ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
        Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
    };
    let mut v = None;
    unsafe { vdev.CreateVideoProcessorInputView(t, e, &desc, Some(&mut v))? };
    Ok(v.unwrap())
}

/* ------------------------------------------------------------------ *
 * Encontrar codificadores
 * ------------------------------------------------------------------ */

const NV12_PARA_H264: (MFT_REGISTER_TYPE_INFO, MFT_REGISTER_TYPE_INFO) = (
    MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 },
    MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 },
);

/// Os MFTs H.264. `luid`: só os da placa com esse LUID (hardware).
fn listar(hardware: bool, luid: Option<LUID>) -> Result<Vec<IMFActivate>> {
    let (entrada, saida) = &NV12_PARA_H264;
    let flags = if hardware {
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER
    } else {
        MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER
    };
    let mut ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut n = 0u32;
    unsafe {
        let mut attrs = None;
        MFCreateAttributes(&mut attrs, 1)?;
        let attrs = attrs.unwrap();
        if let Some(l) = luid {
            let bytes: [u8; 8] = std::mem::transmute(l);
            attrs.SetBlob(&MFT_ENUM_ADAPTER_LUID, &bytes)?;
        }
        MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, flags, Some(entrada), Some(saida), &attrs, &mut ptr, &mut n)?;
        let mut lista = Vec::new();
        if !ptr.is_null() {
            for a in std::slice::from_raw_parts_mut(ptr, n as usize) {
                if let Some(a) = a.take() {
                    lista.push(a);
                }
            }
            CoTaskMemFree(Some(ptr as _));
        }
        Ok(lista)
    }
}

fn nome(a: &IMFAttributes) -> String {
    unsafe {
        let Ok(n) = a.GetStringLength(&MFT_FRIENDLY_NAME_Attribute) else { return "?".into() };
        let mut buf = vec![0u16; n as usize + 1];
        let mut lido = 0;
        if a.GetString(&MFT_FRIENDLY_NAME_Attribute, &mut buf, Some(&mut lido)).is_err() {
            return "?".into();
        }
        String::from_utf16_lossy(&buf[..lido as usize])
    }
}

/// Para o comando `codificadores`: (nome, é de hardware).
pub fn todos() -> Result<Vec<(String, bool)>> {
    let mut v: Vec<(String, bool)> = listar(true, None)?.iter().map(|a| (nome(&a.cast().unwrap()), true)).collect();
    v.extend(listar(false, None)?.iter().map(|a| (nome(&a.cast().unwrap()), false)));
    Ok(v)
}

/* ------------------------------------------------------------------ *
 * Codificador
 * ------------------------------------------------------------------ */

fn var_u32(v: u32) -> VARIANT {
    let mut x = VARIANT::default();
    unsafe {
        (*x.Anonymous.Anonymous).vt = VT_UI4;
        (*x.Anonymous.Anonymous).Anonymous.ulVal = v;
    }
    x
}

fn var_bool(v: bool) -> VARIANT {
    let mut x = VARIANT::default();
    unsafe {
        (*x.Anonymous.Anonymous).vt = VT_BOOL;
        (*x.Anonymous.Anonymous).Anonymous.boolVal = VARIANT_BOOL(if v { -1 } else { 0 });
    }
    x
}

fn ajustar(api: &ICodecAPI, chave: &GUID, v: VARIANT) -> bool {
    unsafe { api.SetValue(chave, &v).is_ok() }
}

fn par(a: u32, b: u32) -> u64 {
    ((a as u64) << 32) | b as u64
}

/// Lê as saídas do MFT. Fica na thread dos eventos (hardware) ou na principal
/// (software).
struct Leitor {
    t: IMFTransform,
    /// Uma chamada ao MFT por vez: o da Intel falha (E_UNEXPECTED) se a banda
    /// muda numa thread enquanto a outra tira a saída.
    trava: Arc<Mutex<()>>,
    fornece: bool,
    tamanho_saida: u32,
    cabecalho: Vec<u8>,
}

/// As NAL de um trecho Annex-B: (início do código de início, tipo, fim).
fn nals(d: &[u8]) -> Vec<(usize, u8, usize)> {
    let mut inicios = Vec::new();
    let mut i = 0;
    while i + 3 <= d.len() {
        if d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1 {
            let codigo = if i > 0 && d[i - 1] == 0 { i - 1 } else { i };
            inicios.push((codigo, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut v = Vec::new();
    for (k, &(codigo, nal)) in inicios.iter().enumerate() {
        let fim = inicios.get(k + 1).map(|p| p.0).unwrap_or(d.len());
        if nal < d.len() {
            v.push((codigo, d[nal] & 0x1f, fim));
        }
    }
    v
}

impl Leitor {
    /// Uma saída, se houver. `Ok(None)`: o MFT precisa de mais entrada.
    fn tirar(&mut self) -> Result<Option<Codificado>> {
        loop {
            let nossa = if self.fornece {
                None
            } else {
                let s = unsafe { MFCreateSample()? };
                let b = unsafe { MFCreateMemoryBuffer(self.tamanho_saida)? };
                unsafe { s.AddBuffer(&b)? };
                Some(s)
            };
            let mut buf = [MFT_OUTPUT_DATA_BUFFER { dwStreamID: 0, pSample: ManuallyDrop::new(nossa), dwStatus: 0, pEvents: ManuallyDrop::new(None) }];
            let mut status = 0u32;
            let r = {
                let _vez = self.trava.lock().unwrap_or_else(|e| e.into_inner());
                unsafe { self.t.ProcessOutput(0, &mut buf, &mut status) }
            };
            let [buf] = buf;
            let amostra = ManuallyDrop::into_inner(buf.pSample);
            drop(ManuallyDrop::into_inner(buf.pEvents));
            match r {
                Ok(()) => {}
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(None),
                // O MFT da Intel se reinicia ao mudar a banda e o aviso de saída
                // que já estava na fila não vale mais.
                Err(e) if e.code() == windows::Win32::Foundation::E_UNEXPECTED => return Ok(None),
                Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
                    unsafe {
                        let tipo = self.t.GetOutputAvailableType(0, 0)?;
                        self.t.SetOutputType(0, &tipo, 0)?;
                    }
                    continue;
                }
                Err(e) => return Err(e),
            }
            let Some(a) = amostra else { return Ok(None) };
            let chave = unsafe { a.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) != 0;
            let tempo = unsafe { a.GetSampleTime() }.unwrap_or(0);
            let b = unsafe { a.ConvertToContiguousBuffer()? };
            let mut p = std::ptr::null_mut();
            let mut n = 0u32;
            let mut dados = unsafe {
                b.Lock(&mut p, None, Some(&mut n))?;
                let v = std::slice::from_raw_parts(p, n as usize).to_vec();
                b.Unlock()?;
                v
            };
            let partes = nals(&dados);
            let chave = chave || partes.iter().any(|p| p.1 == 5);
            let tem_sps = partes.iter().any(|p| p.1 == 7);
            if tem_sps {
                // Guarda SPS/PPS para os quadros-chave que vierem sem eles.
                self.cabecalho = partes.iter().filter(|p| p.1 == 7 || p.1 == 8).flat_map(|p| dados[p.0..p.2].iter().copied()).collect();
            } else if chave {
                if self.cabecalho.is_empty() {
                    self.cabecalho = self.cabecalho_do_tipo();
                }
                let mut v = self.cabecalho.clone();
                v.extend_from_slice(&dados);
                dados = v;
            }
            return Ok(Some(Codificado { dados, chave, tempo }));
        }
    }

    fn cabecalho_do_tipo(&self) -> Vec<u8> {
        unsafe {
            let Ok(tipo) = self.t.GetOutputCurrentType(0) else { return vec![] };
            let Ok(n) = tipo.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) else { return vec![] };
            let mut v = vec![0u8; n as usize];
            let mut lido = 0;
            if tipo.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut v, Some(&mut lido)).is_err() {
                return vec![];
            }
            v.truncate(lido as usize);
            v
        }
    }
}

struct Enviavel<T>(T);
unsafe impl<T> Send for Enviavel<T> {}

pub struct Codificador {
    t: IMFTransform,
    trava: Arc<Mutex<()>>,
    api: Option<ICodecAPI>,
    _gerente: Option<IMFDXGIDeviceManager>,
    pub nome: String,
    pub hardware: bool,
    /// Ajustes que o MFT aceitou (para o relatório).
    pub ajustes: Vec<&'static str>,
    pedidos: u32,
    /// A banda mudou e ainda não saiu quadro: o MFT da Intel já solta um IDR
    /// nessa hora, e forçar outro logo em seguida o derruba (MEError).
    banda_mudou: bool,
    tamanho: (u32, u32),
    qps: u32,
    duracao: i64,
    leitor: Option<Leitor>,
    eventos: Option<JoinHandle<()>>,
}

impl Codificador {
    /// O codificador da placa; sem ele (ou com `software`), o do Windows.
    pub fn novo(placa: &Placa, tam: (u32, u32), qps: u32, bps: u32, software: bool, avisar: Sender<Evento>) -> Result<Codificador> {
        if !software {
            for a in listar(true, Some(placa.luid))? {
                match Self::montar(&a, Some(placa), tam, qps, bps, avisar.clone()) {
                    Ok(c) => return Ok(c),
                    Err(e) => eprintln!("[midia] {} recusou: {e}", nome(&a.cast()?)),
                }
            }
        }
        let mut ultimo = None;
        for a in listar(false, None)? {
            match Self::montar(&a, None, tam, qps, bps, avisar.clone()) {
                Ok(c) => return Ok(c),
                Err(e) => ultimo = Some(e),
            }
        }
        Err(ultimo.unwrap_or_else(|| windows::core::Error::new(MF_E_TOPO_CODEC_NOT_FOUND, "nenhum codificador H.264")))
    }

    fn montar(a: &IMFActivate, placa: Option<&Placa>, (w, h): (u32, u32), qps: u32, bps: u32, avisar: Sender<Evento>) -> Result<Codificador> {
        let nome = nome(&a.cast()?);
        let t: IMFTransform = unsafe { a.ActivateObject()? };
        let attrs = unsafe { t.GetAttributes()? };
        let assincrono = unsafe { attrs.GetUINT32(&MF_TRANSFORM_ASYNC) }.unwrap_or(0) != 0;
        if assincrono {
            unsafe { attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)? };
        }
        let _ = unsafe { attrs.SetUINT32(&MF_LOW_LATENCY, 1) };

        let mut gerente = None;
        if let Some(placa) = placa {
            let mut token = 0u32;
            unsafe {
                MFCreateDXGIDeviceManager(&mut token, &mut gerente)?;
                gerente.as_ref().unwrap().ResetDevice(&placa.device, token)?;
                t.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, gerente.as_ref().unwrap().as_raw() as usize)?;
            }
        }

        // Ajustes aplicados depois dos tipos, antes de começar.
        // VBR com pico (pico = média) em vez de CBR: o MFT da Intel, em CBR,
        // aceita o SetValue da banda durante a transmissão mas ignora calado
        // (o GetValue continua no valor do começo); em VBR com pico, depois
        // dos tipos, a banda muda na hora. Banda baixa demais para a cena: o QP
        // para no 51 e sai mais que o pedido.
        let api: Option<ICodecAPI> = t.cast().ok();
        let mut ajustes = Vec::new();
        let aplicar = |api: &ICodecAPI, ajustes: &mut Vec<&'static str>| {
            ajustes.clear();
            let lista: [(&'static str, &GUID, VARIANT); 7] = [
                ("baixa-latencia", &CODECAPI_AVLowLatencyMode, var_bool(true)),
                ("vbr-com-pico", &CODECAPI_AVEncCommonRateControlMode, var_u32(eAVEncCommonRateControlMode_PeakConstrainedVBR.0 as u32)),
                ("bitrate", &CODECAPI_AVEncCommonMeanBitRate, var_u32(bps)),
                ("pico", &CODECAPI_AVEncCommonMaxBitRate, var_u32(bps)),
                ("sem-b", &CODECAPI_AVEncMPVDefaultBPictureCount, var_u32(0)),
                ("gop-60s", &CODECAPI_AVEncMPVGOPSize, var_u32(qps * 60)),
                ("buffer-1-quadro", &CODECAPI_AVEncCommonBufferSize, var_u32(bps / qps.max(1))),
            ];
            for (n, k, v) in lista {
                if ajustar(api, k, v) {
                    ajustes.push(n);
                }
            }
        };
        let cor = |m: &IMFMediaType| unsafe {
            let _ = m.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32);
            let _ = m.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32);
            let _ = m.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32);
            let _ = m.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32);
        };
        unsafe {
            let saida = MFCreateMediaType()?;
            saida.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            saida.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            saida.SetUINT32(&MF_MT_AVG_BITRATE, bps)?;
            saida.SetUINT64(&MF_MT_FRAME_SIZE, par(w, h))?;
            saida.SetUINT64(&MF_MT_FRAME_RATE, par(qps, 1))?;
            saida.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, par(1, 1))?;
            saida.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            // Baseline: todo receptor WebRTC decodifica (o OpenH264 do Firefox inclusive).
            saida.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base.0 as u32)?;
            cor(&saida);
            t.SetOutputType(0, &saida, 0)?;

            let mut definido = false;
            let mut i = 0;
            while let Ok(entrada) = t.GetInputAvailableType(0, i) {
                i += 1;
                entrada.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12)?;
                entrada.SetUINT64(&MF_MT_FRAME_SIZE, par(w, h))?;
                entrada.SetUINT64(&MF_MT_FRAME_RATE, par(qps, 1))?;
                let _ = entrada.SetUINT32(&MF_MT_DEFAULT_STRIDE, w);
                cor(&entrada);
                if t.SetInputType(0, &entrada, 0).is_ok() {
                    definido = true;
                    break;
                }
            }
            if !definido {
                return Err(windows::core::Error::new(MF_E_TRANSFORM_TYPE_NOT_SET, "nenhum tipo de entrada NV12 aceito"));
            }

            if let Some(api) = &api {
                aplicar(api, &mut ajustes);
            }
            let _ = t.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            t.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            t.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        }

        let info = unsafe { t.GetOutputStreamInfo(0)? };
        let fornece = info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32) != 0;
        let trava = Arc::new(Mutex::new(()));
        let leitor = Leitor { t: t.clone(), trava: trava.clone(), fornece, tamanho_saida: info.cbSize.max(w * h * 3 / 2), cabecalho: vec![] };

        let (leitor, eventos) = if assincrono {
            let gerador: IMFMediaEventGenerator = t.cast()?;
            let pacote = Enviavel((gerador, leitor));
            let fio = std::thread::Builder::new().name("midia-eventos".into()).spawn(move || {
                let pacote = pacote;
                let (gerador, mut leitor) = pacote.0;
                crate::mmcss();
                loop {
                    let ev = match unsafe { gerador.GetEvent(MEDIA_EVENT_GENERATOR_GET_EVENT_FLAGS(0)) } {
                        Ok(ev) => ev,
                        Err(_) => return, // MF_E_SHUTDOWN: o codificador foi desligado.
                    };
                    let tipo = unsafe { ev.GetType() }.unwrap_or(0) as i32;
                    let enviado = if tipo == METransformNeedInput.0 {
                        avisar.send(Evento::Precisa)
                    } else if tipo == MEError.0 {
                        // O MFT morreu (driver, placa reiniciada, banda mudada
                        // no meio de um IDR): quem cuida recria o codificador.
                        let st = unsafe { ev.GetStatus() }.map(|h| h.0).unwrap_or(0);
                        let _ = avisar.send(Evento::Falhou(format!("MEError {st:#x}")));
                        return;
                    } else if tipo == METransformHaveOutput.0 {
                        match leitor.tirar() {
                            Ok(Some(c)) => avisar.send(Evento::Saiu(c)),
                            Ok(None) => Ok(()),
                            Err(e) => avisar.send(Evento::Falhou(format!("ProcessOutput: {e}"))),
                        }
                    } else {
                        Ok(())
                    };
                    if enviado.is_err() {
                        return;
                    }
                }
            });
            (None, Some(fio.map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?))
        } else {
            (Some(leitor), None)
        };

        Ok(Codificador {
            t,
            trava,
            api,
            _gerente: gerente,
            nome,
            hardware: placa.is_some(),
            ajustes,
            pedidos: 0,
            banda_mudou: false,
            tamanho: (w, h),
            qps,
            duracao: 10_000_000 / qps.max(1) as i64,
            leitor,
            eventos,
        })
    }

    /// O MFT assíncrono pediu mais um quadro.
    pub fn precisa(&mut self) {
        self.pedidos += 1;
    }

    /// Dá para entregar um quadro agora?
    pub fn pronto(&self) -> bool {
        self.eventos.is_none() || self.pedidos > 0
    }

    pub fn mudar_bitrate(&mut self, bps: u32) {
        self.banda_mudou = true;
        if let Some(api) = &self.api {
            let _vez = self.trava.lock().unwrap_or_else(|e| e.into_inner());
            ajustar(api, &CODECAPI_AVEncCommonMeanBitRate, var_u32(bps));
            ajustar(api, &CODECAPI_AVEncCommonMaxBitRate, var_u32(bps));
            ajustar(api, &CODECAPI_AVEncCommonBufferSize, var_u32(bps / self.qps.max(1)));
        }
    }

    /// Hardware: a textura NV12 vai direto (cópia zero).
    /// `Ok(false)`: o MFT recusou agora (MF_E_NOTACCEPTING; acontece logo
    /// depois de mudar a banda); o quadro fica para o próximo pedido.
    pub fn enviar_textura(&mut self, nv12: &ID3D11Texture2D, tempo: i64, chave: bool, saida: &mut Vec<Codificado>) -> Result<bool> {
        let b = unsafe { MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, nv12, 0, false)? };
        self.enviar(b, tempo, chave, saida)
    }

    /// Software: os bytes NV12 já na memória.
    pub fn enviar_memoria(&mut self, nv12: &[u8], tempo: i64, chave: bool, saida: &mut Vec<Codificado>) -> Result<bool> {
        unsafe {
            let b = MFCreateMemoryBuffer(nv12.len() as u32)?;
            let mut p = std::ptr::null_mut();
            b.Lock(&mut p, None, None)?;
            std::ptr::copy_nonoverlapping(nv12.as_ptr(), p, nv12.len());
            b.Unlock()?;
            b.SetCurrentLength(nv12.len() as u32)?;
            self.enviar(b, tempo, chave, saida)
        }
    }

    fn enviar(&mut self, b: IMFMediaBuffer, tempo: i64, chave: bool, saida: &mut Vec<Codificado>) -> Result<bool> {
        let vez = self.trava.lock().unwrap_or_else(|e| e.into_inner());
        if chave && !self.banda_mudou {
            if let Some(api) = &self.api {
                ajustar(api, &CODECAPI_AVEncVideoForceKeyFrame, var_u32(1));
            }
        }
        unsafe {
            let s = MFCreateSample()?;
            s.AddBuffer(&b)?;
            s.SetSampleTime(tempo)?;
            s.SetSampleDuration(self.duracao)?;
            match self.t.ProcessInput(0, &s, 0) {
                Err(e) if e.code() == MF_E_NOTACCEPTING => {
                    self.pedidos = 0;
                    return Ok(false);
                }
                r => r?,
            }
        }
        drop(vez);
        self.banda_mudou = false;
        self.pedidos = self.pedidos.saturating_sub(1);
        // Software: a saída sai na hora, nesta mesma thread.
        if let Some(l) = &mut self.leitor {
            while let Some(c) = l.tirar()? {
                saida.push(c);
            }
        }
        Ok(true)
    }

    pub fn tamanho(&self) -> (u32, u32) {
        self.tamanho
    }
}

impl Drop for Codificador {
    fn drop(&mut self) {
        unsafe {
            let _ = self.t.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self.t.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            // Acorda a thread dos eventos com MF_E_SHUTDOWN.
            if let Ok(s) = self.t.cast::<IMFShutdown>() {
                let _ = s.Shutdown();
            }
        }
        if let Some(f) = self.eventos.take() {
            let _ = f.join();
        }
    }
}
