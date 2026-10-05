package com.vcall.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualização do app Android, como a do app de mesa: procura a release mais
 * nova no GitHub ao abrir (no máximo a cada 6 horas) ou quando a pessoa pede,
 * baixa o APK em segundo plano e deixa pronto para instalar.
 *
 * Não precisa da assinatura extra do app de mesa: o próprio Android só aceita
 * a atualização se o APK for assinado com a MESMA chave do app instalado, e
 * recusa versão mais velha. Instalar pede um toque de confirmação do sistema
 * (o app foi instalado fora da Play Store), e só acontece pela tela inicial,
 * nunca no meio de uma chamada.
 */
final class Atualizador {
    static final String RELEASES = "https://api.github.com/repos/victor-kauan-coder/Vcall/releases/latest";
    private static final long INTERVALO = 6 * 60 * 60 * 1000L;

    /** parado | procurando | baixando | pronta | atual | erro */
    private static volatile String fase = "parado";
    private static volatile String versao = "";
    private static volatile String erro = "";
    private static volatile int progresso = 0;
    private static volatile File baixado;

    private Atualizador() {}

    static String estado() {
        try {
            return new JSONObject().put("fase", fase).put("versao", versao).put("erro", erro).put("progresso", progresso).toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** "3.10.0" é mais nova que "3.9.2"; compara número a número. */
    static boolean maisNova(String candidata, String atual) {
        String[] a = candidata.split("\\.");
        String[] b = atual.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? numero(a[i]) : 0;
            int y = i < b.length ? numero(b[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private static int numero(String s) {
        try {
            return Integer.parseInt(s.replaceAll("[^0-9].*$", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** Ao abrir a tela inicial (sozinho, de 6 em 6 horas) ou pelo botão (pedido). */
    static synchronized void procurar(MainActivity tela, boolean pedido) {
        if (fase.equals("procurando") || fase.equals("baixando")) return;
        if (fase.equals("pronta") && baixado != null && baixado.exists()) return;
        SharedPreferences prefs = tela.getSharedPreferences("atualizacao", Context.MODE_PRIVATE);
        long agora = System.currentTimeMillis();
        if (!pedido && agora - prefs.getLong("ultima", 0) < INTERVALO) return;
        mudar(tela, "procurando", "", 0);

        new Thread(() -> {
            try {
                JSONObject rel = new JSONObject(ler(RELEASES));
                // Só conta como verificada se o GitHub respondeu: sem internet ao abrir, tenta de novo na próxima vez.
                prefs.edit().putLong("ultima", agora).apply();
                String nova = rel.getString("tag_name").replaceFirst("^v", "");
                File pasta = new File(tela.getCacheDir(), "atualizacao");
                if (!maisNova(nova, tela.versao())) {
                    apagar(pasta);
                    versao = nova;
                    mudar(tela, "atual", "", 0);
                    return;
                }
                JSONObject apk = null;
                JSONArray anexos = rel.getJSONArray("assets");
                for (int i = 0; i < anexos.length(); i++) {
                    JSONObject a = anexos.getJSONObject(i);
                    if (a.getString("name").matches("Vcall-.*\\.apk")) apk = a;
                }
                if (apk == null) { // versão nova só para o computador
                    versao = nova;
                    mudar(tela, "atual", "", 0);
                    return;
                }
                versao = nova;
                apagar(pasta);
                pasta.mkdirs();
                File destino = new File(pasta, apk.getString("name"));
                baixar(tela, apk.getString("browser_download_url"), destino, apk.getLong("size"));
                baixado = destino;
                mudar(tela, "pronta", "", 100);
            } catch (Exception e) {
                // Sem internet numa verificação automática não é erro para mostrar.
                mudar(tela, pedido ? "erro" : "parado", pedido ? "Não deu para procurar agora. Confira a internet." : "", 0);
            }
        }, "vcall-atualizacao").start();
    }

    /** Passa o APK baixado para o instalador do sistema, que pede a confirmação. */
    static boolean instalar(MainActivity tela) {
        File apk = baixado;
        if (!fase.equals("pronta") || apk == null || !apk.exists()) return false;
        new Thread(() -> {
            try {
                PackageInstaller pi = tela.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                p.setAppPackageName(tela.getPackageName());
                int id = pi.createSession(p);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("vcall.apk", 0, apk.length())) {
                        byte[] buf = new byte[64 * 1024];
                        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                        s.fsync(out);
                    }
                    Intent volta = new Intent(tela, MainActivity.class).setAction(MainActivity.ACAO_INSTALACAO);
                    // Mutável: o instalador escreve o resultado nos extras desta intent.
                    PendingIntent pi2 = PendingIntent.getActivity(tela, 3, volta,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    s.commit(pi2.getIntentSender());
                }
            } catch (Exception e) {
                falhou(tela, "Não deu para abrir o instalador.");
            }
        }, "vcall-instalar").start();
        return true;
    }

    static void falhou(MainActivity tela, String motivo) {
        mudar(tela, "erro", motivo, 0);
        baixado = null;
    }

    private static void mudar(MainActivity tela, String nova, String motivo, int pct) {
        fase = nova;
        erro = motivo;
        progresso = pct;
        tela.evaluar("window.aoAtualizar && window.aoAtualizar(" + estado() + ")");
    }

    private static String ler(String url) throws Exception {
        HttpURLConnection c = abrir(url);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        try (InputStream in = c.getInputStream()) {
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
            return b.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    private static void baixar(MainActivity tela, String url, File destino, long tamanho) throws Exception {
        HttpURLConnection c = abrir(url);
        long lido = 0;
        int ultimo = -1;
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
                lido += n;
                int pct = tamanho > 0 ? (int) (lido * 100 / tamanho) : 0;
                if (pct != ultimo && pct % 10 == 0) {
                    ultimo = pct;
                    mudar(tela, "baixando", "", pct);
                }
            }
        } finally {
            c.disconnect();
        }
        if (tamanho > 0 && lido != tamanho) throw new IllegalStateException("download incompleto");
    }

    private static HttpURLConnection abrir(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true); // o APK mora num endereço de download do GitHub
        c.setRequestProperty("User-Agent", "Vcall-Android");
        return c;
    }

    private static void apagar(File pasta) {
        File[] fs = pasta.listFiles();
        if (fs != null) for (File f : fs) f.delete();
    }
}
