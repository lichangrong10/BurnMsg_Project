package com.burnmsg.app;

import android.app.Activity;
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
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

public class MainActivity extends BridgeActivity {

    private Long downloadId = null;
    private BroadcastReceiver downloadReceiver;
    /** 是否处于系统画中画小窗：小窗里不再按状态栏 inset 给 WebView 父容器加 padding */
    private boolean pipMode = false;
    private final android.os.Handler themeSyncHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private Runnable themeSyncRunnable;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        // 只对 debug 构建开启 WebView 远程调试；release 包不开（否则任何拿到 adb 的人都能看页面内容）。
        // 需要调试 release 行为时，请改用 debug 包验证。
        // 注意：AGP 8 默认不生成 BuildConfig（buildFeatures.buildConfig=false），故用 debuggable 标记判断。
        boolean debuggable = (getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        // super.onCreate(savedInstanceState);
        // registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(DownloadApkPlugin.class);
        registerPlugin(MediaSaverPlugin.class); // v5.8.8：图片保存到系统相册
        registerPlugin(NotifyPermissionPlugin.class); // Android 13+ 运行时申请通知权限
        registerPlugin(KeepAlivePlugin.class);        // 后台保活前台服务开关
        registerPlugin(CallPipPlugin.class);          // 通话画中画（小窗）
        super.onCreate(savedInstanceState);

        // ── 极光推送通知渠道（PUSH_JPUSH.md §3.5）──
        // Android 8+ 通知必须归属某个渠道，且这里的 id 必须与后端推送体里的 channel_id 完全一致（约定统一用 messages）。
        // 不一致或没创建 → 系统静默丢弃通知，现象是「极光控制台显示发送成功，但手机不弹」。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationManager nm =
                    (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel("messages") == null) {
                android.app.NotificationChannel ch = new android.app.NotificationChannel(
                        "messages", "消息通知", android.app.NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("新消息提醒");
                ch.enableVibration(true);
                // 锁屏不展示正文：与后端内容脱敏配合，避免阅后即焚消息在锁屏上露出
                ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
                nm.createNotificationChannel(ch);
            }
        }

        // ── Android 15/16 强制 edge-to-edge 修复 ──
        // 系统 API：状态栏透明悬浮，WebView 内容顶到屏幕顶端，导致顶部 UI 与状态栏重叠。
        // @capacitor/status-bar 的 overlaysWebView/backgroundColor 在 Android 16 已失效；
        // Capacitor 8 的 adjustMarginsForEdgeToEdge 字段在 8.5 尚未实际生效。
        // 这里在原生层手动把状态栏高度作为 padding 加给 WebView，恢复「内容压在状态栏下方」布局，
        // 并把 WebView 底层背景设为主题蓝、状态栏图标设为浅色，避免顶部断层。
        WebView webView = getBridge().getWebView();
        final android.content.SharedPreferences themeSp = getSharedPreferences("burnmsg_prefs", Context.MODE_PRIVATE);
        final String themeColor = themeSp.getString("theme_color", "#3390EC");
        final int themeColorInt = android.graphics.Color.parseColor(themeColor);
        webView.setBackgroundColor(themeColorInt);
        webView.setClipToPadding(true); // 关键修复：true=内容被裁剪在状态栏padding内（避开状态栏）；原false让内容穿透padding顶到状态栏，导致顶部UI与状态栏重叠塌陷
        androidx.core.view.WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
            int types = androidx.core.view.WindowInsetsCompat.Type.systemBars() | androidx.core.view.WindowInsetsCompat.Type.displayCutout();
            androidx.core.graphics.Insets bars = insets.getInsets(types);
            int top = bars.top;
            if (top <= 0) {
                int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
                top = resId > 0 ? getResources().getDimensionPixelSize(resId) : 0;
            }
            androidx.core.graphics.Insets ime = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime()); int bottom = Math.max(ime.bottom, bars.bottom); android.view.View parent = (android.view.View) v.getParent();
            if (parent != null) {
                // 画中画小窗里窗口本身就很小（实测 111dp 高），再按状态栏高度加顶部 padding
                // 会让 WebView 只剩 75dp → 顶部露出一条黑。小窗里统一不加 padding。
                if (pipMode) parent.setPadding(0, 0, 0, 0);
                else parent.setPadding(bars.left, top, bars.right, bottom);
            } // 只推顶部避开状态栏；底部padding去掉(设0)，恢复原样避免顶起输入框/影响键盘
            return new androidx.core.view.WindowInsetsCompat.Builder(insets).setInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars(), androidx.core.graphics.Insets.NONE).setInsets(androidx.core.view.WindowInsetsCompat.Type.displayCutout(), androidx.core.graphics.Insets.NONE).setInsets(androidx.core.view.WindowInsetsCompat.Type.ime(), androidx.core.graphics.Insets.NONE).build(); // 状态栏+导航栏+刘海+键盘insets全清零，Chrome视口铺满WebView，所有避让(顶部/键盘/导航栏)交给父容器padding统一处理
        });
        getWindow().getDecorView().post(() -> {
            int top = 0;
            int resId = getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (resId > 0) top = getResources().getDimensionPixelSize(resId);
            android.view.WindowInsets win = getWindow().getDecorView().getRootWindowInsets();
            if (win != null) {
                int t = androidx.core.view.WindowInsetsCompat
                        .toWindowInsetsCompat(win, getWindow().getDecorView())
                        .getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars()).top;
                if (t > 0) top = t;
            }
            android.view.View parent2 = (android.view.View) webView.getParent();
            if (parent2 != null) { parent2.setPadding(0, top, 0, 0); parent2.setBackgroundColor(themeColorInt); }

            // 状态栏颜色跟随主题色（--tg-blue 为唯一源头）：页面加载后每2秒读一次该CSS变量，同步到状态栏区域背景；换主题色后自动跟上
            themeSyncRunnable = new Runnable() {
                @Override
                public void run() {
                    try {
                        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                        if (wv != null) {
                            wv.evaluateJavascript("getComputedStyle(document.documentElement).getPropertyValue('--tg-blue').trim()", val -> {
                                try {
                                    String c = val == null ? "" : val.replace("\"", "").trim();
                                    if (!c.isEmpty() && !"null".equals(c)) {
                                        android.view.View p = (android.view.View) wv.getParent();
                                        if (p != null) p.setBackgroundColor(android.graphics.Color.parseColor(c)); themeSp.edit().putString("theme_color", c).apply();
                                    }
                                } catch (Exception ignored) {}
                            });
                        }
                    } catch (Exception ignored) {}
                    themeSyncHandler.postDelayed(themeSyncRunnable, 2000);
                }
            };
            themeSyncHandler.postDelayed(themeSyncRunnable, 1500);
        });

        // 语音消息（V5.8.4）：Android 6.0+ 的 RECORD_AUDIO 属运行时权限，WebView getUserMedia 依赖它；
        // 启动时请求一次，用户允许后 Capacitor Bridge 对 WebView 的录音权限请求才会放行。
        // 视频通话（V7.0）：CAMERA 同理（WebView 的 RESOURCE_VIDEO_CAPTURE 需要它），一并申请。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.ArrayList<String> needPerms = new java.util.ArrayList<>();
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                needPerms.add(android.Manifest.permission.RECORD_AUDIO);
            }
            if (checkSelfPermission(android.Manifest.permission.CAMERA)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                needPerms.add(android.Manifest.permission.CAMERA);
            }
            if (!needPerms.isEmpty()) {
                requestPermissions(needPerms.toArray(new String[0]), 1001);
            }
        }
    }

    /**
     * Capacitor 自定义插件：后台保活前台服务的开关（供 JS 在登录后开启 / 退出登录时关闭）
     */
    @CapacitorPlugin(name = "KeepAlive")
    public static class KeepAlivePlugin extends Plugin {

        @PluginMethod
        public void enable(PluginCall call) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            try {
                Intent i = new Intent(getContext(), KeepAliveService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(i);
                } else {
                    getContext().startService(i);
                }
                ret.put("running", true);
                call.resolve(ret);
            } catch (Exception e) {
                ret.put("running", false);
                ret.put("error", String.valueOf(e.getMessage()));
                call.resolve(ret);
            }
        }

        @PluginMethod
        public void disable(PluginCall call) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            try {
                getContext().stopService(new Intent(getContext(), KeepAliveService.class));
                ret.put("running", false);
            } catch (Exception e) {
                ret.put("running", false);
            }
            call.resolve(ret);
        }
    }

    /**
     * Capacitor 自定义插件：Android 13+ 运行时申请通知权限（POST_NOTIFICATIONS）
     *
     * 为什么不用 Cordova 插件的 requestPermission()：它内部依赖 Cordova 全局 device 对象，
     * App 挂载那一刻 device 往往还没注入 → 抛异常被 try/catch 吞掉 → 系统弹窗从来没出现过。
     * 这里直接用 Capacitor 的 @Permission 机制，可靠且能拿到用户的选择结果。
     */
    @CapacitorPlugin(
        name = "NotifyPermission",
        permissions = @com.getcapacitor.annotation.Permission(
            alias = "notifications",
            strings = { android.Manifest.permission.POST_NOTIFICATIONS }
        )
    )
    public static class NotifyPermissionPlugin extends Plugin {

        /** 检查并按需申请；已授权则直接返回 granted=true，不重复打扰 */
        @PluginMethod
        public void ensure(PluginCall call) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("sdk", Build.VERSION.SDK_INT);
            // Android 13 以下没有该运行时权限，通知默认可用
            if (Build.VERSION.SDK_INT < 33) {
                ret.put("granted", true);
                ret.put("needRequest", false);
                call.resolve(ret);
                return;
            }
            boolean granted = getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED;
            if (granted) {
                ret.put("granted", true);
                ret.put("needRequest", false);
                call.resolve(ret);
                return;
            }
            ret.put("granted", false);
            ret.put("needRequest", true);
            call.resolve(ret);
            // 弹系统授权框（结果在回调里，前端不阻塞等待）
            requestPermissionForAlias("notifications", null, "onPermissionResult");
        }

        @com.getcapacitor.annotation.PermissionCallback
        private void onPermissionResult(PluginCall call) {
            boolean granted = getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED;
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            ret.put("granted", granted);
            ret.put("needRequest", !granted);
            if (call != null) call.resolve(ret);
            notifyListeners("permissionResult", ret);
        }

        /**
         * 只查询当前是否已授权（不弹任何框），供「我的」页展示状态
         */
        @PluginMethod
        public void check(PluginCall call) {
            com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
            boolean granted = Build.VERSION.SDK_INT < 33
                    || getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED;
            ret.put("granted", granted);
            ret.put("sdk", Build.VERSION.SDK_INT);
            call.resolve(ret);
        }

        /**
         * 直达系统的「本应用通知设置」页。
         * 用户拒绝过两次后系统不再弹授权框，只能靠这个入口手动打开。
         */
        @PluginMethod
        public void openSettings(PluginCall call) {
            try {
                Intent intent;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    // Android 8+：直达「焚信 → 通知」页，少点两层
                    intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
                } else {
                    intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                }
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                // 部分 ROM 没有该 Action，退回应用详情页
                try {
                    Intent fallback = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    fallback.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback);
                    call.resolve();
                } catch (Exception e2) {
                    call.reject("打开设置页失败: " + e2.getMessage());
                }
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        themeSyncHandler.removeCallbacksAndMessages(null);
        if (downloadReceiver != null) {
            try { unregisterReceiver(downloadReceiver); } catch (Exception e) { /* ignore */ }
        }
    }

    /**
     * 用户按 Home / 切走时（API 31 以下没有 setAutoEnterEnabled，走这里主动进小窗）。
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                && CallPipPlugin.isEnabled()) {
            android.app.PictureInPictureParams p = CallPipPlugin.currentParams();
            if (p != null) {
                try { enterPictureInPictureMode(p); } catch (Exception ignored) { /* 机型不支持则忽略 */ }
            }
        }
    }

    /** 小窗进入/退出：把状态推给前端，用于切换紧凑布局 / 判定「小窗被划掉」 */
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode,
                                              android.content.res.Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        pipMode = isInPictureInPictureMode;
        try {
            WebView wv0 = getBridge() != null ? getBridge().getWebView() : null;
            if (wv0 != null) {
                // 直接改父容器 padding，不依赖 inset 监听是否会被重新派发（实测 requestApplyInsets 不保证回调）
                android.view.View parent = (android.view.View) wv0.getParent();
                if (isInPictureInPictureMode) {
                    if (parent != null) parent.setPadding(0, 0, 0, 0);
                    wv0.setPadding(0, 0, 0, 0);
                    wv0.setFitsSystemWindows(false);
                    // 兜底：隐藏系统栏会触发新一轮 inset 派发，监听可能把 padding 又加回来，
                    // 这里在 120ms / 400ms 各再清一次，确保最终状态是 0。
                    final android.view.View p2 = parent;
                    wv0.postDelayed(() -> {
                        try {
                            if (pipMode && p2 != null) p2.setPadding(0, 0, 0, 0);
                        } catch (Exception ignored) { /* 忽略 */ }
                    }, 120);
                    wv0.postDelayed(() -> {
                        try {
                            if (pipMode && p2 != null) p2.setPadding(0, 0, 0, 0);
                            if (pipMode) { wv0.requestLayout(); wv0.invalidate(); }
                        } catch (Exception ignored) { /* 忽略 */ }
                    }, 400);
                }
                wv0.requestLayout();
                wv0.invalidate();
                wv0.requestApplyInsets();
            }
        } catch (Exception ignored) { /* 忽略 */ }
        // 小窗里窗口高 111dp，而 WebView 视口只有 75dp，差的 36dp ≈ 状态栏 inset 没有被绘制，
        // 表现为小窗顶部一条黑。进小窗时把系统栏隐藏、WebView 顶到窗口边界即可消除。
        try {
            final android.view.View decor = getWindow().getDecorView();
            androidx.core.view.WindowInsetsControllerCompat ctl =
                    androidx.core.view.WindowCompat.getInsetsController(getWindow(), decor);
            if (isInPictureInPictureMode) {
                androidx.core.view.WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
                ctl.setSystemBarsBehavior(
                        androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                ctl.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars());
                decor.setPadding(0, 0, 0, 0);
                // 关键：inset 可能是被 Capacitor 的根容器消费掉的（decor.setPadding 无效），
                // 直接在 android.R.id.content 上把 inset 全部吃掉，WebView 才能铺到窗口顶端。
                final android.view.View root = findViewById(android.R.id.content);
                if (root != null) {
                    androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(
                            root, (v, insets) -> androidx.core.view.WindowInsetsCompat.CONSUMED);
                    root.requestApplyInsets();
                    root.setPadding(0, 0, 0, 0);
                }
            } else {
                ctl.show(androidx.core.view.WindowInsetsCompat.Type.systemBars());
            }
        } catch (Exception ignored) { /* 忽略 */ }
        // 小窗让 Activity 尺寸骤变，WebView 有时来不及重排/重绘（表现为白块棋盘格或只显示一截）。
        // 这里延迟强制一次布局 + 重绘，等系统把新的窗口尺寸下发完再画。
        try {
            final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv != null) {
                if (isInPictureInPictureMode) {
                    wv.setFitsSystemWindows(false);
                    wv.setPadding(0, 0, 0, 0);
                    android.view.ViewGroup.LayoutParams lp = wv.getLayoutParams();
                    if (lp != null) {
                        lp.width = android.view.ViewGroup.LayoutParams.MATCH_PARENT;
                        lp.height = android.view.ViewGroup.LayoutParams.MATCH_PARENT;
                        wv.setLayoutParams(lp);
                    }
                }
                wv.postDelayed(() -> {
                    try {
                        wv.requestLayout();
                        wv.invalidate();
                    } catch (Exception ignored) { /* 忽略 */ }
                }, 60);
                wv.postDelayed(() -> {
                    try {
                        wv.requestLayout();
                        wv.invalidate();
                    } catch (Exception ignored) { /* 忽略 */ }
                }, 260);
            }
        } catch (Exception ignored) { /* 忽略 */ }
        CallPipPlugin.notifyPipChanged(isInPictureInPictureMode);
    }

    /**
     * Capacitor 自定义插件：通话画中画（小窗）
     *
     * 前端在通话 active 时调 enable()，结束调 disable()。
     * 小窗内不提供任何按钮：点小窗由系统展开回全屏。
     */
    @CapacitorPlugin(name = "CallPip")
    public static class CallPipPlugin extends Plugin {

        private static CallPipPlugin instance;
        private static boolean enabled = false;
        private static android.app.PictureInPictureParams params;

        @Override
        public void load() {
            instance = this;
        }

        static boolean isEnabled() { return enabled && instance != null; }

        /**
         * 把任意宽高比归到最接近的标准比例（竖 9:16 / 3:4、方 1:1、横 4:3 / 16:9）。
         * 远端是横屏时用 16:9 开小窗，画面才不会被竖窗裁掉两侧。
         */
        private static int[] pickRatio(double ratio) {
            double[][] table = { {9, 16}, {3, 4}, {1, 1}, {4, 3}, {16, 9} };
            double best = Double.MAX_VALUE;
            int[] out = { 9, 16 };
            for (double[] t : table) {
                double diff = Math.abs((t[0] / t[1]) - ratio);
                if (diff < best) { best = diff; out = new int[] { (int) t[0], (int) t[1] }; }
            }
            return out;
        }

        static android.app.PictureInPictureParams currentParams() { return params; }

        static void notifyPipChanged(boolean inPip) {
            if (instance == null) return;
            JSObject ret = new JSObject();
            ret.put("inPip", inPip);
            instance.notifyListeners("pipChange", ret);
        }

        /** 当前设备是否支持画中画 */
        @PluginMethod
        public void isSupported(PluginCall call) {
            boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && getContext().getPackageManager()
                        .hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE);
            JSObject ret = new JSObject();
            ret.put("supported", supported);
            call.resolve(ret);
        }

        /**
         * 开启小窗能力。
         * @param aspectRatio 宽高比（视频 9/16≈0.5625，语音 1）
         */
        @PluginMethod
        public void enable(PluginCall call) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { call.resolve(); return; }
            double ratio = call.getDouble("aspectRatio", 9.0 / 16.0);
            int[] wh = pickRatio(ratio);
            int w = wh[0], h = wh[1];

            android.app.PictureInPictureParams.Builder builder =
                    new android.app.PictureInPictureParams.Builder()
                            .setAspectRatio(new android.util.Rational(w, h));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(true); // 切后台自动进小窗，无需用户手动
                builder.setSeamlessResizeEnabled(true); // 窗口尺寸过渡期间也持续重排，避免白块/残帧
            }
            params = builder.build();
            enabled = true;
            try {
                Activity act = getActivity();
                if (act != null) act.setPictureInPictureParams(params);
            } catch (Exception ignored) { /* 部分 ROM 不支持 */ }
            call.resolve();
        }

        /** 通话结束时收起小窗：把任务移到后台，PiP 随之消失（不会退出 App） */
        @PluginMethod
        public void closePip(PluginCall call) {
            try {
                Activity act = getActivity();
                if (act != null) act.moveTaskToBack(true);
            } catch (Exception ignored) { /* 忽略 */ }
            call.resolve();
        }

        /** 关闭小窗能力（通话结束时调用，避免平时切后台也进小窗） */
        @PluginMethod
        public void disable(PluginCall call) {
            enabled = false;
            params = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    Activity act = getActivity();
                    if (act != null) {
                        act.setPictureInPictureParams(
                                new android.app.PictureInPictureParams.Builder()
                                        .setAutoEnterEnabled(false).build());
                    }
                } catch (Exception ignored) { /* ignore */ }
            }
            call.resolve();
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
