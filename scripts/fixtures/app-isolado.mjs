/**
 * scripts/fixtures/app-isolado.mjs — o app de mesa de desenvolvimento sem
 * mexer no Vcall instalado.
 *
 * Rodar desktop/main.js pelo Electron de node_modules regrava o `vcall://` do
 * Windows para o electron.exe de dev (os convites deixam de abrir o Vcall
 * instalado) e divide a pasta de dados e a trava de instância com ele. Aqui:
 * pasta de dados própria (VCALL_USERDATA) e o registro do protocolo anulado.
 * A porta já recua sozinha se a 7718 estiver ocupada (desktop/main.js).
 */
import { app } from "electron";

if (process.env.VCALL_USERDATA) app.setPath("userData", process.env.VCALL_USERDATA);
app.setAsDefaultProtocolClient = () => true;
// Para testes com uma janela fora da tela: sem isto o Chromium a dá por
// coberta e para de desenhar (a captura recebe quadro nenhum).
if (process.env.VCALL_SEM_OCLUSAO) app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

await import("../../desktop/main.js");
