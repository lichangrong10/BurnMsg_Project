package com.burnmsg.app;

import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 图片保存到系统相册（V5.8.8）。
 *
 * 背景：WebView 里 <a download> + blob 在安卓 App 中要么被静默忽略、要么只落 App 私有目录，
 * 永远不会出现在系统相册。相册只索引 MediaStore 里的媒体，必须原生侧写入：
 *   - Android 10+（API 29+）：ContentResolver.insert(MediaStore.Images) + RELATIVE_PATH，
 *     免存储权限，插入即进相册索引；IS_PENDING 防半截文件闪现。
 *   - Android 7-9（API 24-28）：直写公共 Pictures/BurnMsg + MediaScannerConnection 扫描，
 *     需要 WRITE_EXTERNAL_STORAGE 运行时权限（缺权限 reject PERMISSION_REQUIRED，
 *     前端提示重试，requestCode=1002 弹系统授权框）。
 *
 * 数据面：前端只传完整 URL，原生 HttpURLConnection 直下（与 DownloadApkPlugin 同模式，
 * cleartext 已开），避免大图 base64 过桥卡顿。
 */
@CapacitorPlugin(name = "MediaSaver")
public class MediaSaverPlugin extends Plugin {

    @PluginMethod
    public void saveImage(PluginCall call) {
        final String url = call.getString("url");
        final String rawName = call.getString("name", "image.jpg");
        if (url == null || url.isEmpty()) { call.reject("url is required"); return; }

        // 文件名安全化：DISPLAY_NAME 不允许路径分隔符等
        final String name = rawName.replaceAll("[\\\\/:*?\"<>|]", "_");

        final Context ctx = getContext();
        if (ctx == null) { call.reject("Context 不可用"); return; }

        // Android 7-9：公共目录写入需要运行时权限；Android 10+ 走 MediaStore 免权限
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && ctx.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            try {
                if (getActivity() != null) {
                    getActivity().requestPermissions(
                            new String[]{ android.Manifest.permission.WRITE_EXTERNAL_STORAGE }, 1002);
                }
            } catch (Exception ignore) { }
            call.reject("PERMISSION_REQUIRED");
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(120000);
                conn.connect();
                int code = conn.getResponseCode();
                if (code != 200) { call.reject("下载失败 HTTP " + code); return; }

                byte[] data;
                try (InputStream in = conn.getInputStream()) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    int n;
                    while ((n = in.read(chunk)) != -1) buf.write(chunk, 0, n);
                    data = buf.toByteArray();
                }
                if (data.length == 0) { call.reject("下载内容为空"); return; }

                // MIME：HTTP Content-Type 优先（截掉 ; charset 段），非 image/ 兜底 jpeg
                String mime = conn.getContentType();
                if (mime != null) mime = mime.split(";")[0].trim();
                if (mime == null || !mime.startsWith("image/")) mime = "image/jpeg";

                Uri savedUri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                    v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                    v.put(MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/BurnMsg");
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri uri = ctx.getContentResolver()
                            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) { call.reject("相册写入失败（insert null）"); return; }
                    try (OutputStream os = ctx.getContentResolver().openOutputStream(uri)) {
                        if (os == null) { call.reject("相册写入失败（stream null）"); return; }
                        os.write(data);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    ctx.getContentResolver().update(uri, done, null, null);
                    savedUri = uri;
                } else {
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                            "BurnMsg");
                    if (!dir.exists() && !dir.mkdirs()) { call.reject("目录创建失败"); return; }
                    File f = new File(dir, name);
                    try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(data); }
                    MediaScannerConnection.scanFile(ctx, new String[]{ f.getAbsolutePath() },
                            new String[]{ mime }, null);
                    savedUri = Uri.fromFile(f);
                }

                JSObject ret = new JSObject();
                ret.put("uri", savedUri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("保存失败: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()), e);
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
