#!/bin/sh
# Lançador do Vcall no Linux. O programa de verdade é o vcall-bin, ao lado
# (scripts/linux/depois-de-empacotar.cjs troca um pelo outro no build).
#
# O Chromium isola cada página com user namespaces ou, sem eles, com o
# chrome-sandbox (setuid root). Quando nenhum dos dois funciona, ele aborta ao
# subir, com SIGTRAP, antes de qualquer código do Vcall rodar: de dentro do app
# não dá para decidir. É o caso do AppImage e do .tar.gz no Ubuntu 24.04+, onde
# o AppArmor restringe os namespaces e o chrome-sandbox não tem como ser
# setuid. Aí, e só aí, o Vcall abre sem o sandbox.
aqui=$(dirname "$(readlink -f "$0")")
sandbox="$aqui/chrome-sandbox"

# chrome-sandbox do root com setuid (pacotes .deb/.rpm/pacman): sandbox normal.
# Dentro do AppImage nunca vale: a montagem é nosuid.
if [ -z "$APPIMAGE" ] && [ -u "$sandbox" ] && [ "$(stat -c %u "$sandbox" 2>/dev/null)" = 0 ]; then
  exec "$aqui/vcall-bin" "$@"
fi

# Namespaces restritos pelo AppArmor, ou o teste do unshare (o mesmo que o
# Chromium faz: criar um e mapear o próprio usuário) falha.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = 1 ] ||
  { command -v unshare >/dev/null 2>&1 && ! unshare --user --map-root-user true >/dev/null 2>&1; }; then
  exec "$aqui/vcall-bin" --no-sandbox "$@"
fi
exec "$aqui/vcall-bin" "$@"
