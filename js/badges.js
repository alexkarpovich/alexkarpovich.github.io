(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./duration"));
  else root.TimeBadges = factory(root.TimeDuration);
})(typeof self !== "undefined" ? self : this, function (TimeDuration) {
  function badgesFor(summary, settings) {
    const badges = [];
    if (summary.ownMinutes > 0) {
      badges.push({
        kind: "time",
        text: TimeDuration.formatDuration(summary.ownMinutes, settings),
        color: "blue"
      });
    }
    if (summary.limitMinutes == null) return badges;
    if (!summary.kidsKnown) {
      badges.push({
        kind: "limit",
        text: "limit " + TimeDuration.formatDuration(summary.limitMinutes, settings),
        color: "light-gray"
      });
      return badges;
    }
    const left = summary.limitMinutes - summary.spentMinutes;
    if (left < 0) {
      badges.push({
        kind: "over",
        text: "over " + TimeDuration.formatDuration(-left, settings),
        color: "red"
      });
    } else if (left === 0) {
      badges.push({ kind: "left", text: "0m left", color: "orange" });
    } else {
      badges.push({
        kind: "left",
        text: TimeDuration.formatDuration(left, settings) + " left",
        color: left / summary.limitMinutes <= 0.2 ? "orange" : "green"
      });
    }
    return badges;
  }

  return { badgesFor: badgesFor };
});
