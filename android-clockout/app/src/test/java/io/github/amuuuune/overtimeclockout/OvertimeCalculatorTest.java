package io.github.amuuuune.overtimeclockout;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

public final class OvertimeCalculatorTest {
    private static final LocalDate WORK_DATE = LocalDate.of(2026, 7, 31);

    @Test
    public void excludesEveryEveningBreak() {
        assertStandardMinutes("17:00", 0);
        assertStandardMinutes("17:15", 0);
        assertStandardMinutes("17:16", 1);
        assertStandardMinutes("19:15", 120);
        assertStandardMinutes("19:30", 120);
        assertStandardMinutes("19:31", 121);
        assertStandardMinutes("21:30", 240);
        assertStandardMinutes("21:45", 240);
        assertStandardMinutes("21:46", 241);
    }

    @Test
    public void truncatesSecondsToOneMinute() throws Exception {
        ZonedDateTime tappedAt = ZonedDateTime.of(
            2026, 7, 31, 17, 16, 59, 999_000_000, ZoneId.of("Asia/Tokyo")
        );
        assertEquals(1, OvertimeCalculator.calculate(tappedAt, "").overtimeMinutes);
    }

    @Test
    public void addsPendingEarlyStart() throws Exception {
        ZonedDateTime tappedAt = ZonedDateTime.of(
            2026, 7, 31, 16, 30, 0, 0, ZoneId.of("Asia/Tokyo")
        );
        assertEquals(35, OvertimeCalculator.calculate(tappedAt, "08:00").overtimeMinutes);
    }

    @Test(expected = OvertimeCalculator.UnsupportedTimeException.class)
    public void rejectsAmbiguousAfterMidnightPunch() throws Exception {
        ZonedDateTime tappedAt = ZonedDateTime.of(
            2026, 8, 1, 0, 30, 0, 0, ZoneId.of("Asia/Tokyo")
        );
        OvertimeCalculator.calculate(tappedAt, "");
    }

    @Test
    public void retainsTwelvePayPeriods() {
        assertEquals(
            LocalDate.of(2025, 8, 16),
            OvertimeCalculator.retentionStart(LocalDate.of(2026, 7, 31))
        );
        assertEquals(
            LocalDate.of(2025, 7, 16),
            OvertimeCalculator.retentionStart(LocalDate.of(2026, 7, 15))
        );
    }

    private void assertStandardMinutes(String time, int expected) {
        assertEquals(
            expected,
            OvertimeCalculator.calculateStandardMinutes(
                WORK_DATE,
                LocalDateTime.parse(WORK_DATE + "T" + time)
            )
        );
    }
}
