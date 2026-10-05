# A página chama estes métodos pelo nome (window.VcallAndroid.*).
-keepclassmembers class com.vcall.app.Ponte {
    @android.webkit.JavascriptInterface <methods>;
}
