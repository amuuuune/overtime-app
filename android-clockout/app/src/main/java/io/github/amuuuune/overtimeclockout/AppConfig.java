package io.github.amuuuune.overtimeclockout;

import java.time.ZoneId;

final class AppConfig {
    static final String SUPABASE_URL = "https://amijlzfjamcstxchwkud.supabase.co";
    static final String SUPABASE_PUBLISHABLE_KEY = "sb_publishable_oHGPXeQxwEjeK7HlF9gDZQ_HA39G8y0";
    static final String AUTH_REDIRECT_URL = "https://amuuuune.github.io/overtime-app/android-auth/";
    static final ZoneId JAPAN_ZONE = ZoneId.of("Asia/Tokyo");

    private AppConfig() {
    }
}

