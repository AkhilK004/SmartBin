import { useMemo } from "react";
import { useStore } from "../store";
import { INTERVAL_LABEL, fmt } from "../format";
import { PageTitle, Empty } from "../ui";

/** Next 14 days, one row per zone. A filled square is a collection day; today is the accent line. */
export default function CalendarPanel() {
  const zones = useStore((s) => s.zones);
  const sim = useStore((s) => s.sim);
  const focusOn = useStore((s) => s.focusOn);

  const today = sim ? fmt.localDate(sim.now) : "";
  const days = useMemo(() => {
    const set = new Set<string>();
    for (const z of zones) for (const d of z.calendar) set.add(d);
    if (today) set.add(today);
    return [...set].sort().slice(0, 14);
  }, [zones, today]);

  const dueToday = zones.filter((z) => z.calendar.includes(today)).length;

  return (
    <div>
      <PageTitle
        title="Collection calendar"
        finding={zones.length ? `${dueToday} zone(s) due today. Intervals come from each zone's fill rate.` : undefined}
      />
      {zones.length === 0 ? (
        <Empty>No zones yet.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[340px] border-separate border-spacing-0 text-small">
              <thead>
                <tr>
                  <th className="w-[96px] pb-2 text-left font-normal text-muted">Zone</th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={`pb-2 text-center font-normal ${d === today ? "text-ink" : "text-muted"}`}>
                      <div className={`relative mx-auto w-5 ${d === today ? "after:absolute after:-bottom-1 after:left-0 after:right-0 after:h-px after:bg-accent" : ""}`}>
                        {Number(d.slice(8))}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.zone_id}>
                    <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                      <button className="truncate text-left text-body hover:underline" onClick={() => focusOn("zone", z.zone_id)}>
                        {z.name}
                      </button>
                    </th>
                    {days.map((d) => {
                      const on = z.calendar.includes(d);
                      return (
                        <td key={d} className="py-1.5 text-center">
                          <span
                            className={`mx-auto block h-4 w-4 rounded-sm ${on ? "bg-ink" : "bg-raised"}`}
                            role="img"
                            aria-label={`${z.name} ${on ? "collected" : "no collection"} on ${fmt.day(d)}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-small text-muted">
            Days shown are the dates of the month, starting today. A white square means the primary truck is due.
          </p>

          <h2 className="mb-2 mt-6 text-[16px] font-semibold">Current intervals</h2>
          <table className="w-full text-body">
            <thead>
              <tr className="text-small text-muted">
                <th className="pb-1 text-left font-normal">Zone</th>
                <th className="pb-1 text-left font-normal">Interval</th>
                <th className="pb-1 text-right font-normal">Fill a day</th>
                <th className="pb-1 text-right font-normal">Days to 85%</th>
                <th className="pb-1 text-right font-normal">Next</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((z) => (
                <tr key={z.zone_id} className="border-t border-rule">
                  <td className="h-[42px] font-medium">{z.name}</td>
                  <td>{INTERVAL_LABEL[z.interval_label]}</td>
                  <td className="text-right">{fmt.dec(z.fill_rate_pct_per_day, 1)}%</td>
                  <td className="text-right">{fmt.dec(z.days_to_85, 1)}</td>
                  <td className="text-right">{z.next_collection_date === today ? "Today" : fmt.day(z.next_collection_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-small text-muted">
            Fill rates come from sensor history, or from seed values until there is enough of it. Both are simulated.
          </p>
        </>
      )}
    </div>
  );
}
