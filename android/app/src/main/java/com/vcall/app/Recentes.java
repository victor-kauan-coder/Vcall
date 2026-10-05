package com.vcall.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * As últimas salas abertas, para voltar com um toque enquanto o link vale
 * (o túnel do app de mesa muda de endereço quando ele fecha).
 */
final class Recentes {
    private static final int MAXIMO = 6;

    private Recentes() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("recentes", Context.MODE_PRIVATE);
    }

    static synchronized String lista(Context c) {
        return prefs(c).getString("lista", "[]");
    }

    static synchronized void guardar(Context c, String url) {
        try {
            JSONArray antiga = new JSONArray(lista(c));
            JSONArray nova = new JSONArray();
            nova.put(new JSONObject().put("url", url).put("quando", System.currentTimeMillis()));
            for (int i = 0; i < antiga.length() && nova.length() < MAXIMO; i++) {
                JSONObject r = antiga.getJSONObject(i);
                if (!url.equals(r.optString("url"))) nova.put(r);
            }
            prefs(c).edit().putString("lista", nova.toString()).apply();
        } catch (Exception ignorado) {
            prefs(c).edit().remove("lista").apply();
        }
    }

    static synchronized void esquecer(Context c, String url) {
        try {
            JSONArray antiga = new JSONArray(lista(c));
            JSONArray nova = new JSONArray();
            for (int i = 0; i < antiga.length(); i++) {
                JSONObject r = antiga.getJSONObject(i);
                if (!url.equals(r.optString("url"))) nova.put(r);
            }
            prefs(c).edit().putString("lista", nova.toString()).apply();
        } catch (Exception ignorado) {
            prefs(c).edit().remove("lista").apply();
        }
    }
}
