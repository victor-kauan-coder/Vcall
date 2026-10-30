/**
 * afterPack do electron-builder: no Linux, o executável "vcall" vira o
 * lançador (scripts/linux/vcall.sh) e o Electron passa a se chamar vcall-bin.
 * Vale para todos os formatos, porque todos saem da mesma pasta empacotada.
 */
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function depoisDeEmpacotar({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== "linux") return;
  const exe = path.join(appOutDir, packager.executableName);
  fs.renameSync(exe, `${exe}-bin`);
  // Sem CR: um checkout do Windows não pode virar "#!/bin/sh\r".
  fs.writeFileSync(exe, fs.readFileSync(path.join(__dirname, "vcall.sh"), "utf8").replace(/\r\n/g, "\n"));
  fs.chmodSync(exe, 0o755);
};
