#include "AutoAuctionOpponentCap.h"
#include "AutoAuctionResponseFormatting.h"
#include "AutoCollectCabinetRewardStateFormatting.h"
#include "AutoCollectCabinetRewardSchedulerSemantics.h"
#include "UiClickComponentSemantics.h"

#include <assert.h>

int main() {
    int value = 0;
    assert(TryParseHistoryRoundNumber("第4轮", &value) && value == 4);
    assert(TryParseHistoryRoundNumber("Round 5", &value) && value == 5);
    assert(!TryParseHistoryRoundNumber("--", &value));
    assert(!TryParseHistoryRoundNumber("Round 5 / 6", &value));

    assert(TryParsePriceText("17,986", &value) && value == 17986);
    assert(TryParsePriceText("17，986", &value) && value == 17986);
    assert(TryParsePriceText("17986", &value) && value == 17986);
    assert(!TryParsePriceText("", &value));
    assert(!TryParsePriceText("0", &value));
    assert(!TryParsePriceText("12a34", &value));

    double multiplier = 0.0;
    assert(TryGetOpponentCapMultiplier(2, &multiplier) && multiplier == 1.65);
    assert(TryGetOpponentCapMultiplier(3, &multiplier) && multiplier == 1.4);
    assert(TryGetOpponentCapMultiplier(4, &multiplier) && multiplier == 1.23);
    assert(TryGetOpponentCapMultiplier(5, &multiplier) && multiplier == 1.1);
    assert(!TryGetOpponentCapMultiplier(1, &multiplier));
    assert(!TryGetOpponentCapMultiplier(6, &multiplier));

    int slot = 0;
    assert(TryResolveOpponentSlot("melo", "melo", "澈澈澈", &slot) && slot == 2);
    assert(TryResolveOpponentSlot("melo", "澈澈澈", "melo", &slot) && slot == 1);
    assert(TryResolveOpponentSlot("melo", "巅峰收藏家1", "巅峰收藏家2", &slot) && slot == 2);
    assert(!TryResolveOpponentSlot("melo", "", "", &slot));
    assert(!TryResolveOpponentSlot("melo", "melo", "melo", &slot));
    assert(!TryResolveOpponentSlot("melo", "澈澈澈", "澈澈澈", &slot));
    assert(!TryResolveOpponentSlot("melo", "巅峰收藏家1", "陌生人", &slot));

    assert(IsAutoAuctionWinnerSelf("melo", "melo"));
    assert(!IsAutoAuctionWinnerSelf("melo", "对手"));
    assert(!IsAutoAuctionWinnerSelf("melo", ""));
    assert(ShouldWaitForQuickRecycle("melo", "melo"));
    assert(!ShouldWaitForQuickRecycle("melo", "对手"));

    assert(ComputeOpponentCappedBid(50000, 44444, 1.4) == 50000);
    assert(ComputeOpponentCappedBid(90000, 44444, 1.4) == 62221);
    assert(ResolveUiClickComponentKind(false, false) == UI_CLICK_COMPONENT_NONE);
    assert(ResolveUiClickComponentKind(true, false) == UI_CLICK_COMPONENT_BUTTON);
    assert(ResolveUiClickComponentKind(false, true) == UI_CLICK_COMPONENT_TOGGLE);
    assert(ResolveUiClickComponentKind(true, true) == UI_CLICK_COMPONENT_BUTTON);
    assert(BuildAutoAuctionAuthCodeRequiredResult(2, 60000)
           == "{\"result\":\"authcode_required\",\"reason\":\"authcode_detected\",\"rounds\":2,\"expectedPrice\":60000}");
    assert(BuildAutoAuctionRoomEntryLimitReachedResult(0, 50000)
           == "{\"result\":\"room_entry_limit_reached\",\"reason\":\"daily_room_entry_limit_reached\",\"rounds\":0,\"expectedPrice\":50000}");
    std::string roomEntryLimitResult;
    assert(TryBuildAutoAuctionRoomEntryLimitReachedResultFromCountText(
        "今日次数：<color=#FF0000>100/100",
        0,
        50000,
        &roomEntryLimitResult
    ));
    assert(roomEntryLimitResult
           == "{\"result\":\"room_entry_limit_reached\",\"reason\":\"daily_room_entry_limit_reached\",\"rounds\":0,\"expectedPrice\":50000}");
    assert(!TryBuildAutoAuctionRoomEntryLimitReachedResultFromCountText(
        "今日次数：100/1000",
        0,
        50000,
        &roomEntryLimitResult
    ));
    assert(roomEntryLimitResult.empty());
    assert(!TryBuildAutoAuctionRoomEntryLimitReachedResultFromCountText(
        "今日次数：99/100",
        0,
        50000,
        &roomEntryLimitResult
    ));
    assert(roomEntryLimitResult.empty());

    assert(ConvertWindowsFileTime100nsToUnixMs(116444736000000000ULL) == 0ULL);
    assert(ConvertWindowsFileTime100nsToUnixMs(116444736010000000ULL) == 1000ULL);

    AutoCollectCabinetRewardStateSnapshot disabledState = {};
    disabledState.enabled = false;
    disabledState.running = false;
    disabledState.intervalMs = 10800000;
    disabledState.nextCheckInMs = -1;
    disabledState.lastCheckAtUnixMs = 0;
    disabledState.lastResultCode = "never_run";
    disabledState.lastResultMessage = "";
    disabledState.lastObservedScreen = "";
    assert(
        BuildAutoCollectCabinetRewardStateJson(disabledState) ==
        "{\"enabled\":false,\"running\":false,\"intervalMs\":10800000,\"nextCheckInMs\":null,\"lastCheckAtUnixMs\":0,\"lastResultCode\":\"never_run\",\"lastResultMessage\":\"\",\"lastObservedScreen\":\"\"}"
    );

    AutoCollectCabinetRewardStateSnapshot enabledState = {};
    enabledState.enabled = true;
    enabledState.running = true;
    enabledState.intervalMs = 10800000;
    enabledState.nextCheckInMs = 3210;
    enabledState.lastCheckAtUnixMs = 1710000000123ULL;
    enabledState.lastResultCode = "running";
    enabledState.lastResultMessage = "cycle active";
    enabledState.lastObservedScreen = "main_lobby";
    assert(
        BuildAutoCollectCabinetRewardStateJson(enabledState) ==
        "{\"enabled\":true,\"running\":true,\"intervalMs\":10800000,\"nextCheckInMs\":3210,\"lastCheckAtUnixMs\":1710000000123,\"lastResultCode\":\"running\",\"lastResultMessage\":\"cycle active\",\"lastObservedScreen\":\"main_lobby\"}"
    );

    bool enabledFlag = false;
    assert(TryParseStrictJsonBoolField("{\"enabled\":true}", "enabled", &enabledFlag) && enabledFlag);
    assert(TryParseStrictJsonBoolField("{\"enabled\": false}", "enabled", &enabledFlag) && !enabledFlag);
    assert(!TryParseStrictJsonBoolField("{\"enabled\":1}", "enabled", &enabledFlag));
    assert(!TryParseStrictJsonBoolField("{\"enabled\":0}", "enabled", &enabledFlag));
    assert(!TryParseStrictJsonBoolField("{\"enabled\":\"true\"}", "enabled", &enabledFlag));

    assert(ResolveAutoCollectCabinetRewardDueTick(true, 1000ULL, 10800000ULL) == 10801000ULL);
    assert(ResolveAutoCollectCabinetRewardDueTick(false, 1000ULL, 10800000ULL) == 0ULL);
    assert(NextAutoCollectCabinetRewardControlVersion(7ULL) == 8ULL);

    assert(CanAutoCollectCabinetRewardCycleStart(true, 5ULL, 5ULL));
    assert(!CanAutoCollectCabinetRewardCycleStart(false, 5ULL, 5ULL));
    assert(!CanAutoCollectCabinetRewardCycleStart(true, 5ULL, 6ULL));

    assert(ShouldAutoCollectCabinetRewardWorkerReschedule(9ULL, 9ULL));
    assert(!ShouldAutoCollectCabinetRewardWorkerReschedule(9ULL, 10ULL));

    return 0;
}
