# Novidades da 3.12

## 3.12.1: atualizar no Linux sem travar

- **.deb e .rpm:** "Reiniciar e atualizar" fecha o Vcall primeiro; depois o
  sistema pede a senha, instala e abre o Vcall de novo. Antes a instalação
  rodava com a janela aberta e congelada ("não está respondendo") e trocava os
  arquivos do app com ele aberto.
- **AppImage:** a versão nova não carrega mais os arquivos abertos da antiga;
  a versão velha sai de vez e o espaço em disco é liberado.

## Voz que aguenta rede ruim

Cada pacote de voz leva uma cópia do anterior (RED), o Opus corrige perdas
isoladas (FEC) e quem está calado quase não gasta banda (DTX). O som da tela
vai em estéreo. → [Conexão, voz e relé](Conexao-e-rele)

## Relé: a sala se ajuda

Se a conexão direta entre duas pessoas cai, uma terceira repassa voz e vídeo
até ela voltar. Quem tem internet fraca, ou está no celular numa sala de 4+,
manda o vídeo uma vez só, para um computador forte da sala.
→ [Conexão, voz e relé](Conexao-e-rele)

## Menos quedas

Na troca de rede (Wi-Fi para 4G) a conexão é refeita na hora, e uma conexão
que congela sem o navegador perceber é refeita sozinha.

## Servidor TURN nas configurações

Em **Configurações › Servidor TURN**: link de provedor (Metered), coturn próprio
ou usuário e senha, com botão **Testar**. → [Conexão, voz e relé](Conexao-e-rele#servidor-turn)

## Correção

Os jogos novos não sumem mais logo depois de atualizar o app.
