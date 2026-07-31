package io.github.amuuuune.overtimeclockout;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.widget.Toast;

import java.time.DayOfWeek;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ClockOutActivity extends Activity {
    private static final DateTimeFormatter CLOCK_FORMAT = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("M/d");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean started;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (started) {
            return;
        }
        started = true;

        SessionStore sessionStore = new SessionStore(this);
        SessionStore.Session session = sessionStore.load();
        if (session == null) {
            openSetup("最初にSupabaseと連携します。");
            return;
        }

        ZonedDateTime tappedAt = ZonedDateTime.now(AppConfig.JAPAN_ZONE);
        if (tappedAt.getHour() < 5) {
            finishWithToast("深夜の退勤は17+から打刻してください。");
            return;
        }
        if (tappedAt.getDayOfWeek() == DayOfWeek.SATURDAY
            || tappedAt.getDayOfWeek() == DayOfWeek.SUNDAY) {
            finishWithToast("休日出勤は17+から打刻してください。");
            return;
        }

        Toast.makeText(this, "退勤を打刻中です。", Toast.LENGTH_SHORT).show();
        executor.execute(() -> performClockOut(sessionStore, session, tappedAt));
    }

    private void performClockOut(
        SessionStore sessionStore,
        SessionStore.Session storedSession,
        ZonedDateTime tappedAt
    ) {
        SupabaseClient client = new SupabaseClient();
        try {
            SupabaseClient.RefreshedSession refreshed = client.refreshSession(storedSession.refreshToken);

            // Refresh tokens rotate. Persist the new pair before doing any other network work.
            sessionStore.save(new SessionStore.Session(refreshed.accessToken, refreshed.refreshToken));

            String earlyStart = client.getEarlyStart(refreshed.user, tappedAt.toLocalDate());
            OvertimeCalculator.Result result = OvertimeCalculator.calculate(tappedAt, earlyStart);

            if (client.recordExists(refreshed.accessToken, result.workDate)) {
                finishWithToast(result.workDate.format(DATE_FORMAT) + "は打刻済みです。上書きしていません。");
                return;
            }

            client.insertRecord(
                refreshed.accessToken,
                result.workDate,
                result.clockOutAt,
                result.overtimeMinutes
            );

            if (!earlyStart.isEmpty()) {
                try {
                    client.clearEarlyStart(refreshed.accessToken, refreshed.user, result.workDate);
                } catch (SupabaseClient.ClientException ignored) {
                    // The record itself is complete. The main app can clean up stale early-start metadata.
                }
            }
            try {
                client.deleteRecordsBefore(
                    refreshed.accessToken,
                    OvertimeCalculator.retentionStart(result.workDate)
                );
            } catch (SupabaseClient.ClientException ignored) {
                // Retention cleanup is best effort and must not turn a successful punch into an error.
            }

            vibrateSuccess();
            String message = result.clockOutTime.format(CLOCK_FORMAT)
                + " 退勤打刻済み（残業 "
                + OvertimeCalculator.formatMinutes(result.overtimeMinutes)
                + "）";
            finishWithToast(message);
        } catch (OvertimeCalculator.UnsupportedTimeException error) {
            finishWithToast("深夜の退勤は17+から打刻してください。");
        } catch (SupabaseClient.ClientException error) {
            if (error.status == 409) {
                finishWithToast(workDateText(tappedAt) + "は打刻済みです。上書きしていません。");
                return;
            }
            if (error.needsLogin) {
                sessionStore.clear();
                openSetupFromWorker("ログインの有効期限が切れました。もう一度連携してください。");
                return;
            }
            finishWithToast("打刻できませんでした。通信を確認して、もう一度押してください。");
        } catch (Exception error) {
            finishWithToast("打刻できませんでした。もう一度押してください。");
        } finally {
            executor.shutdown();
        }
    }

    private String workDateText(ZonedDateTime tappedAt) {
        return tappedAt.toLocalDate().format(DATE_FORMAT);
    }

    private void openSetup(String message) {
        Intent intent = new Intent(this, SetupActivity.class);
        intent.putExtra(SetupActivity.EXTRA_MESSAGE, message);
        startActivity(intent);
        finish();
    }

    private void openSetupFromWorker(String message) {
        runOnUiThread(() -> openSetup(message));
    }

    private void finishWithToast(String message) {
        runOnUiThread(() -> {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show();
            finish();
            disableExitAnimation();
        });
    }

    @SuppressWarnings("deprecation")
    private void disableExitAnimation() {
        if (Build.VERSION.SDK_INT >= 34) {
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, 0);
        } else {
            overridePendingTransition(0, 0);
        }
    }

    private void vibrateSuccess() {
        Vibrator vibrator = getSystemService(Vibrator.class);
        if (vibrator != null && vibrator.hasVibrator()) {
            vibrator.vibrate(VibrationEffect.createOneShot(55, VibrationEffect.DEFAULT_AMPLITUDE));
        }
    }
}
