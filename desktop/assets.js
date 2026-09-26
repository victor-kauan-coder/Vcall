/**
 * desktop/assets.js — de onde vem a interface.
 *
 * Em desenvolvimento, de lugar nenhum: o servidor lê a pasta public/ do disco,
 * que é o que permite recarregar a página e ver a mudança na hora.
 *
 * No executável, este arquivo é TROCADO em tempo de compilação pelo módulo
 * gerado com todos os arquivos embutidos (ver scripts/build-exe.mjs). A troca é
 * feita por módulo, e não por uma variável global preenchida antes do import,
 * porque `import` é içado para o topo: a variável só seria atribuída depois de
 * o servidor já ter subido lendo o disco que não existe.
 */
export const assets = null;
