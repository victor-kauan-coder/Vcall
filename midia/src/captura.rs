//! Captura pelo Windows Graphics Capture (WGC), direto numa textura da placa.
//!
//! A placa (o ID3D11Device) é criada no adaptador ligado à tela capturada.
//! Num notebook híbrido (Intel + NVIDIA) a tela do notebook sai pela Intel:
//! capturar e codificar ali evita copiar cada quadro de uma placa para a outra.
//!
//! `MinUpdateInterval` de 1 ms: sem ele o WGC entrega uns 50 qps mesmo num
//! monitor de 144 Hz (robmikh/Win32CaptureSample#82). Só existe do Windows 11
//! 24H2 em diante; antes disso o pedido falha e a captura fica no padrão.

use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, LUID};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::core::{IInspectable, Interface, Ref, Result};

/// A placa de vídeo onde tudo acontece: captura, conversão e codificação.
pub struct Placa {
    pub device: ID3D11Device,
    pub contexto: ID3D11DeviceContext,
    pub luid: LUID,
    pub nome: String,
}

/// O que capturar.
pub enum Alvo {
    /// Índice da tela; 0 é a principal.
    Tela(usize),
    /// Janela pelo HWND (é o número do meio do id "window:HWND:0" do Electron).
    Janela(isize),
    /// A tela que contém este ponto, em pixels físicos (o app de mesa sabe o
    /// retângulo de cada tela, não a ordem do DXGI).
    Ponto(i32, i32),
}

struct Saida {
    adaptador: IDXGIAdapter1,
    monitor: HMONITOR,
    principal: bool,
}

fn saidas() -> Result<Vec<Saida>> {
    let fabrica: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    let mut lista = Vec::new();
    let mut a = 0;
    while let Ok(adaptador) = unsafe { fabrica.EnumAdapters1(a) } {
        let mut s = 0;
        while let Ok(saida) = unsafe { adaptador.EnumOutputs(s) } {
            let d = unsafe { saida.GetDesc()? };
            if d.AttachedToDesktop.as_bool() {
                let r = d.DesktopCoordinates;
                lista.push(Saida { adaptador: adaptador.clone(), monitor: d.Monitor, principal: r.left == 0 && r.top == 0 });
            }
            s += 1;
        }
        a += 1;
    }
    // A principal primeiro; o resto na ordem do sistema.
    lista.sort_by_key(|s| !s.principal);
    Ok(lista)
}

fn criar_placa(adaptador: Option<&IDXGIAdapter1>) -> Result<Placa> {
    let mut device = None;
    let mut contexto = None;
    let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT;
    unsafe {
        D3D11CreateDevice(
            adaptador.map(|a| a.cast::<IDXGIAdapter>()).transpose()?.as_ref(),
            if adaptador.is_some() { D3D_DRIVER_TYPE_UNKNOWN } else { windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE },
            HMODULE::default(),
            flags,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut contexto),
        )?
    };
    let device: ID3D11Device = device.unwrap();
    let contexto: ID3D11DeviceContext = contexto.unwrap();
    // O Media Foundation usa a mesma placa de outra thread.
    let _ = unsafe { contexto.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true) };
    let dxgi: IDXGIDevice = device.cast()?;
    let d = unsafe { dxgi.GetAdapter()?.GetDesc()? };
    let fim = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
    Ok(Placa { device, contexto, luid: d.AdapterLuid, nome: String::from_utf16_lossy(&d.Description[..fim]) })
}

pub struct Captura {
    pub placa: Placa,
    pub tamanho: (u32, u32),
    pool: Direct3D11CaptureFramePool,
    sessao: GraphicsCaptureSession,
    pool_tam: (i32, i32),
    pub intervalo_minimo: bool,
}

/// Um quadro capturado: a textura BGRA e o instante em que a tela mudou
/// (relógio QPC, em unidades de 100 ns).
pub struct Quadro {
    pub textura: ID3D11Texture2D,
    pub tempo: i64,
    _quadro: windows::Graphics::Capture::Direct3D11CaptureFrame,
}

impl Captura {
    /// `avisar` é chamado (de outra thread) a cada quadro novo da tela.
    pub fn abrir(alvo: &Alvo, avisar: impl Fn() + Send + Sync + 'static) -> Result<Captura> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let (item, placa): (GraphicsCaptureItem, Placa) = match *alvo {
            Alvo::Tela(i) => {
                let lista = saidas()?;
                let s = lista.get(i).ok_or_else(|| windows::core::Error::new(windows::Win32::Foundation::E_INVALIDARG, "tela não existe"))?;
                (unsafe { interop.CreateForMonitor(s.monitor)? }, criar_placa(Some(&s.adaptador))?)
            }
            Alvo::Ponto(x, y) => {
                let mon = unsafe { windows::Win32::Graphics::Gdi::MonitorFromPoint(windows::Win32::Foundation::POINT { x, y }, windows::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST) };
                let s = saidas()?.into_iter().find(|s| s.monitor == mon).ok_or_else(|| windows::core::Error::new(windows::Win32::Foundation::E_INVALIDARG, "nenhuma tela nesse ponto"))?;
                (unsafe { interop.CreateForMonitor(s.monitor)? }, criar_placa(Some(&s.adaptador))?)
            }
            Alvo::Janela(h) => {
                let hwnd = HWND(h as *mut _);
                // A janela pode estar em qualquer tela; a placa da tela em que ela está.
                let mon = unsafe { windows::Win32::Graphics::Gdi::MonitorFromWindow(hwnd, windows::Win32::Graphics::Gdi::MONITOR_DEFAULTTONEAREST) };
                let adaptador = saidas()?.into_iter().find(|s| s.monitor == mon).map(|s| s.adaptador);
                (unsafe { interop.CreateForWindow(hwnd)? }, criar_placa(adaptador.as_ref())?)
            }
        };

        let dxgi: IDXGIDevice = placa.device.cast()?;
        let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let tam = item.Size()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, tam)?;
        let sessao = pool.CreateCaptureSession(&item)?;
        // Borda amarela e cursor: falham em Windows antigos, e tudo bem.
        let _ = sessao.SetIsBorderRequired(false);
        let _ = sessao.SetIsCursorCaptureEnabled(true);
        let intervalo_minimo = sessao.SetMinUpdateInterval(TimeSpan { Duration: 10_000 }).is_ok();

        pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
            move |_: Ref<Direct3D11CaptureFramePool>, _: Ref<IInspectable>| {
                avisar();
                Ok(())
            },
        ))?;
        sessao.StartCapture()?;
        Ok(Captura { placa, tamanho: (tam.Width as u32, tam.Height as u32), pool, sessao, pool_tam: (tam.Width, tam.Height), intervalo_minimo })
    }

    /// O quadro mais novo; os mais velhos que estiverem na fila são largados.
    /// `None` se nada mudou na tela desde a última vez.
    pub fn proximo(&mut self) -> Result<Option<Quadro>> {
        let mut ultimo = None;
        while let Ok(q) = self.pool.TryGetNextFrame() {
            ultimo = Some(q);
        }
        let Some(q) = ultimo else { return Ok(None) };
        let tam = q.ContentSize()?;
        if (tam.Width, tam.Height) != self.pool_tam {
            // Janela redimensionada: o pool passa a ter o tamanho novo; o
            // codificador continua no tamanho do começo (ver Conversor::converter).
            self.pool_tam = (tam.Width, tam.Height);
            let dxgi: IDXGIDevice = self.placa.device.cast()?;
            let d3d: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
            self.pool.Recreate(&d3d, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, SizeInt32 { Width: tam.Width.max(2), Height: tam.Height.max(2) })?;
        }
        let acesso: IDirect3DDxgiInterfaceAccess = q.Surface()?.cast()?;
        let textura: ID3D11Texture2D = unsafe { acesso.GetInterface()? };
        Ok(Some(Quadro { textura, tempo: q.SystemRelativeTime()?.Duration, _quadro: q }))
    }
}

impl Drop for Captura {
    fn drop(&mut self) {
        let _ = self.sessao.Close();
        let _ = self.pool.Close();
    }
}
