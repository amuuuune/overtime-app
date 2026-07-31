package io.github.amuuuune.overtimeclockout;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

final class OvertimeCalculator {
    private static final LocalTime WORKDAY_START = LocalTime.of(8, 35);
    private static final LocalTime OVERTIME_START = LocalTime.of(17, 0);
    private static final LocalTime[][] BREAKS = {
        { LocalTime.of(17, 0), LocalTime.of(17, 15) },
        { LocalTime.of(19, 15), LocalTime.of(19, 30) },
        { LocalTime.of(21, 30), LocalTime.of(21, 45) },
    };

    private OvertimeCalculator() {
    }

    static Result calculate(ZonedDateTime tappedAt, String earlyStartValue) throws UnsupportedTimeException {
        ZonedDateTime clockOut = tappedAt
            .withZoneSameInstant(AppConfig.JAPAN_ZONE)
            .truncatedTo(ChronoUnit.MINUTES);
        if (clockOut.getHour() < 5) {
            throw new UnsupportedTimeException();
        }

        LocalDate workDate = clockOut.toLocalDate();
        int minutes = calculateStandardMinutes(workDate, clockOut.toLocalDateTime());
        minutes += calculateEarlyMinutes(earlyStartValue);
        return new Result(
            workDate,
            clockOut.toInstant().toString(),
            clockOut.toLocalTime(),
            Math.max(0, minutes)
        );
    }

    static int calculateStandardMinutes(LocalDate workDate, LocalDateTime clockOut) {
        LocalDateTime start = LocalDateTime.of(workDate, OVERTIME_START);
        if (!clockOut.isAfter(start)) {
            return 0;
        }

        long minutes = Duration.between(start, clockOut.truncatedTo(ChronoUnit.MINUTES)).toMinutes();
        for (LocalTime[] workBreak : BREAKS) {
            LocalDateTime breakStart = LocalDateTime.of(workDate, workBreak[0]);
            LocalDateTime breakEnd = LocalDateTime.of(workDate, workBreak[1]);
            minutes -= overlapMinutes(start, clockOut, breakStart, breakEnd);
        }
        return (int) Math.max(0, minutes);
    }

    static int calculateEarlyMinutes(String earlyStartValue) {
        if (earlyStartValue == null || earlyStartValue.isBlank()) {
            return 0;
        }
        try {
            LocalTime earlyStart = LocalTime.parse(earlyStartValue, DateTimeFormatter.ofPattern("HH:mm"));
            if (!earlyStart.isBefore(WORKDAY_START)) {
                return 0;
            }
            return (int) Duration.between(earlyStart, WORKDAY_START).toMinutes();
        } catch (RuntimeException error) {
            return 0;
        }
    }

    static LocalDate retentionStart(LocalDate today) {
        LocalDate currentPeriodStart = today.getDayOfMonth() >= 16
            ? today.withDayOfMonth(16)
            : today.minusMonths(1).withDayOfMonth(16);
        return currentPeriodStart.minusMonths(11);
    }

    static String formatMinutes(int minutes) {
        int safeMinutes = Math.max(0, minutes);
        if (safeMinutes < 60) {
            return safeMinutes + "分";
        }
        int hours = safeMinutes / 60;
        int remainder = safeMinutes % 60;
        return remainder == 0 ? hours + "時間" : hours + "時間" + remainder + "分";
    }

    private static long overlapMinutes(
        LocalDateTime rangeStart,
        LocalDateTime rangeEnd,
        LocalDateTime breakStart,
        LocalDateTime breakEnd
    ) {
        LocalDateTime overlapStart = rangeStart.isAfter(breakStart) ? rangeStart : breakStart;
        LocalDateTime overlapEnd = rangeEnd.isBefore(breakEnd) ? rangeEnd : breakEnd;
        if (!overlapEnd.isAfter(overlapStart)) {
            return 0;
        }
        return Duration.between(overlapStart, overlapEnd).toMinutes();
    }

    static final class Result {
        final LocalDate workDate;
        final String clockOutAt;
        final LocalTime clockOutTime;
        final int overtimeMinutes;

        Result(LocalDate workDate, String clockOutAt, LocalTime clockOutTime, int overtimeMinutes) {
            this.workDate = workDate;
            this.clockOutAt = clockOutAt;
            this.clockOutTime = clockOutTime;
            this.overtimeMinutes = overtimeMinutes;
        }
    }

    static final class UnsupportedTimeException extends Exception {
    }
}
