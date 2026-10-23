package com.burnmsg.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * 后台保活前台服务
 *
 * 背景：极光「自有通道」依赖 App 进程存活。切到后台一段时间后系统会冻结进程（Doze / 应用待机），
 * 长连接被回收 → 推送收不到，只能等重新打开 App 时由极光补发（表现为"一股脑全弹出来"）。
 *
 * 前台服务（Foreground Service）会让进程保持活跃，不被系统优先冻结，从而让长连接存活更久。
 * 代价是通知栏会常驻一条「正在接收消息」的低优先级通知（IMPORTANCE_LOW，不响不吵，可被用户在系统里关掉）。
 *
 * 注意：这只解决「挂后台」场景；App 被用户手动杀掉 / 被清理时仍需厂商通道才能唤醒。
 */
public class KeepAliveService extends Service {

    private static final String CHANNEL_ID = "keepalive";
    private static final int NOTIFY_ID = 1001;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_notify) // 24×24 纯白剪影，与推送通知图标一致
                .setContentTitle("焚信")
                .setContentText("正在接收消息，保证提醒及时送达")
                .setPriority(NotificationCompat.PRIORITY_LOW) // 不出横幅、不响铃
                .setOngoing(true)                             // 不可滑动清除
                .setShowWhen(false)
                .build();
        try {
            // Android 10+ 需要显式声明前台服务类型（与 manifest 的 foregroundServiceType 一致）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFY_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFY_ID, n);
            }
        } catch (Exception e) {
            // Android 14+ 类型不被允许 / 通知权限被拒时会抛异常，退化为普通通知，保证服务不崩
            try { startForeground(NOTIFY_ID, n); } catch (Exception ignored) { /* 忽略 */ }
        }
        return START_STICKY; // 被系统回收后尽量自动拉起
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "后台运行", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("保证消息提醒及时送达；关闭后 App 在后台可能收不到通知");
                ch.setShowBadge(false);
                ch.enableVibration(false);
                ch.setSound(null, null);
                nm.createNotificationChannel(ch);
            }
        }
    }
}
