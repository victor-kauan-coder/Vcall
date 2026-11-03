# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The Windows builds of Vcall (`Vcall.exe` and the `VcallSetup-<version>.exe` installer) are signed in CI by
[`.github/workflows/release.yml`](.github/workflows/release.yml), only from tags of this repository. Only the project's
own binaries are signed. Third-party binaries shipped with Vcall (such as `cloudflared.exe`) keep their publisher's own signature.

## Team roles

- Committers and reviewers: [victor-kauan-coder](https://github.com/victor-kauan-coder)
- Approvers: [victor-kauan-coder](https://github.com/victor-kauan-coder)

All team members use multi-factor authentication on GitHub and SignPath.

## Privacy policy

Calls are peer to peer and end-to-end encrypted; there is no Vcall account and no Vcall server collecting data.
Vcall contacts other systems only for what the user does or turns on:

- STUN servers (Google, Cloudflare) to find a direct connection between call participants;
- GitHub, to check for and download updates;
- Cloudflare (`cloudflared`) or Tailscale, when the user creates a public link;
- is.gd / TinyURL, when the user asks for a short link;
- Hugging Face / alphacephei.com, to download speech models when the user turns on captions.

---

# Política de assinatura (resumo)

Os executáveis do Windows são assinados de graça pela SignPath Foundation, no CI, a cada versão publicada. O editor que aparece
no Windows é a **SignPath Foundation**. O Vcall não manda dados para nenhum servidor próprio; as conexões externas estão listadas acima.
