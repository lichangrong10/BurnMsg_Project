package com.burnmsg.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private Long downloadId = null;
    private BroadcastReceiver downloadReceiver;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        // super.onCreate(savedInstanceState);
        // registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(DownloadApkPlugin.class);
        registerPlugin(MediaSaverPlugin.class); // v5.8.8：图片保存到系统相册
        super.onCreate(savedInstanceState);

        // ── Android 15/16 强制 edge-to-edge 修复 ──
        // 系统 API：状态栏透明悬浮，WebView 内容顶到屏幕顶端，导致顶部 UI 与状态栏重叠。
        // @capacitor/status-bar 的 overlaysWebView/backgroundColor 在 Android 16 已失效；
        // Capacitor 8 的 adjustMarginsForEdgeToEdge 字段在 8.5 尚未实际生效。
        // 这里在原生层手动把状态栏高度作为 padding 加给 WebView，恢复「内容压在状态栏下方」布局，
        // 并把 WebView 底层背景设为主题蓝、状态栏图标设为浅色，避免顶部断层。
        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(android.graphics.Color.parseColor("#3390EC"));
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            int top = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top;
            v.setPadding(0, top, 0, 0);
            return insets;
        });
        androidx.core.view.ViewCompat.requestApplyInsets(webView);

        // 语音消息（V5.8.4）：Android 6.0+ 的 RECORD_AUDIO 属运行时权限，WebView getUserMedia 依赖它；
        // 启动时请求一次，用户允许后 Capacitor Bridge 对 WebView 的录音权限请求才会放行
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ android.Manifest.permission.RECORD_AUDIO }, 1001);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (downloadReceiver != null) {
            try { unregisterReceiver(downloadReceiver); } catch (Exception e) { /* ignore */ }
        }
    }

    /**
     * Capacitor 自定义插件：APK 下载 + 安装
     */
    @CapacitorPlugin(name = "AppUpdater")
    public static class AppUpdaterPlugin extends Plugin {

        private Long downloadId = null;
        private BroadcastReceiver downloadReceiver;
        private android.os.Handler progressHandler;
        private Runnable progressRunnable;

        @PluginMethod
        public void downloadAndInstall(PluginCall call) {
            String url = call.getString("url");
            if (url == null || url.isEmpty()) {
                call.reject("缺少 APK 下载地址");
                return;
            }

            Context ctx = getContext();
            if (ctx == null) {
                call.reject("Context 不可用");
                return;
            }

            try {
                // 使用 DownloadManager 下载 APK
                DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setTitle("焚信更新");
                request.setDescription("正在下载新版本…");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, "burnmsg-update.apk");
                request.setMimeType("application/vnd.android.package-archive");

                // 取消之前的下载
                if (downloadId != null) {
                    dm.remove(downloadId);
                }

                downloadId = dm.enqueue(request);

                // 进度轮询（每 500ms 查询 DownloadManager 推送百分比）
                progressHandler = new android.os.Handler(android.os.Looper.getMainLooper());
                progressRunnable = new Runnable() {
                    @Override
                    public void run() {
                        DownloadManager.Query q = new DownloadManager.Query();
                        q.setFilterById(downloadId);
                        Cursor c = dm.query(q);
                        boolean keep = false;
                        if (c != null && c.moveToFirst()) {
                            int st = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                            if (st == DownloadManager.STATUS_RUNNING) {
                                long done = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                                long total = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                                if (total > 0) {
                                    com.getcapacitor.JSObject d = new com.getcapacitor.JSObject();
                                    d.put("progress", (int)(done * 100 / total));
                                    notifyListeners("downloadProgress", d);
                                }
                                keep = true;
                            } else if (st == DownloadManager.STATUS_PENDING) {
                                keep = true;
                            }
                            c.close();
                        }
                        if (keep) progressHandler.postDelayed(this, 500);
                    }
                };
                progressHandler.postDelayed(progressRunnable, 500);

                // 注册下载完成广播
                if (downloadReceiver != null) {
                    try { ctx.unregisterReceiver(downloadReceiver); } catch (Exception e) { /* ignore */ }
                }
                downloadReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                        if (id == downloadId) {
                            // 查询下载状态
                            DownloadManager.Query query = new DownloadManager.Query();
                            query.setFilterById(id);
                            Cursor cursor = dm.query(query);
                            if (cursor != null && cursor.moveToFirst()) {
                                int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                                int status = cursor.getInt(statusIdx);
                                if (status == DownloadManager.STATUS_SUCCESSFUL) {
                                    String path = cursor.getString(cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI));
                                    cursor.close();
                                    if (progressHandler != null && progressRunnable != null) progressHandler.removeCallbacks(progressRunnable);
                                    notifyListeners("downloadComplete", new com.getcapacitor.JSObject());
                                    installApk(context, path);
                                } else if (status == DownloadManager.STATUS_FAILED) {
                                    cursor.close();
                                    if (progressHandler != null && progressRunnable != null) progressHandler.removeCallbacks(progressRunnable);
                                    notifyError("下载失败");
                                }
                            }
                        }
                    }
                };
                ctx.registerReceiver(downloadReceiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));

                // 通知前端下载已开始
                call.resolve(new com.getcapacitor.JSObject() {{
                    put("success", true);
                    put("message", "开始下载");
                }});

            } catch (Exception e) {
                call.reject("下载失败: " + e.getMessage());
            }
        }

        private void installApk(Context ctx, String fileUri) {
            try {
                File file = new File(Uri.parse(fileUri).getPath());
                if (!file.exists()) {
                    // 尝试直接从 URI 获取路径
                    String path = fileUri.replace("file://", "");
                    file = new File(path);
                }

                Uri apkUri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    apkUri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
                } else {
                    apkUri = Uri.fromFile(file);
                }

                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                ctx.startActivity(intent);
            } catch (Exception e) {
                notifyError("安装失败: " + e.getMessage());
            }
        }

        private void notifyError(String msg) {
            // 通过 bridge 通知前端
            try {
                com.getcapacitor.JSObject data = new com.getcapacitor.JSObject();
                data.put("error", msg);
                notifyListeners("downloadError", data);
            } catch (Exception e) { /* ignore */ }
        }
    }
}