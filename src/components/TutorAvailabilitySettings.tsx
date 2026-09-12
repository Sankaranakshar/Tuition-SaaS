import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "./kit";

const FIELD_CLASS =
  "block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

interface AvailabilitySlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

const DAYS_OF_WEEK = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

export default function TutorAvailabilitySettings() {
  const { user } = useAuth();
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newDay, setNewDay] = useState(1); // Default Monday
  const [newStartTime, setNewStartTime] = useState("09:00");
  const [newEndTime, setNewEndTime] = useState("17:00");

  useEffect(() => {
    if (!user?.organizationId || !user?.id) return;
    fetchSlots();
  }, [user]);

  const fetchSlots = async () => {
    if (!user?.organizationId || !user?.id) return;
    try {
      const { data, error } = await supabase
        .from("tutor_availability")
        .select("*")
        .eq("organization_id", user.organizationId)
        .eq("tutor_id", user.id);
      if (error) throw error;

      // A row's presence represents availability — there's no isAvailable
      // column (the old field was always true, never toggled false anywhere
      // in this file, so dropping it changes nothing observable).
      const fetchedSlots: AvailabilitySlot[] = (data || []).map((row) => ({
        id: row.id,
        dayOfWeek: row.day_of_week,
        startTime: row.start_time?.slice(0, 5) ?? row.start_time,
        endTime: row.end_time?.slice(0, 5) ?? row.end_time,
        isAvailable: true,
      }));

      // Sort by day then start time
      fetchedSlots.sort((a, b) => {
        if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
        return a.startTime.localeCompare(b.startTime);
      });

      setSlots(fetchedSlots);
    } catch (err: any) {
      console.error("Error fetching availability:", err);
      setError("Failed to load availability slots.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSlot = async () => {
    if (!user?.organizationId || !user?.id) return;

    // Basic validation
    if (newStartTime >= newEndTime) {
      setError("Start time must be before end time.");
      return;
    }

    try {
      setError("");
      const { error } = await supabase.from("tutor_availability").insert({
        organization_id: user.organizationId,
        tutor_id: user.id,
        day_of_week: newDay,
        start_time: newStartTime,
        end_time: newEndTime,
      });
      if (error) throw error;
      await fetchSlots();
    } catch (err: any) {
      console.error("Error adding slot:", err);
      setError("Failed to add availability slot.");
    }
  };

  const handleDeleteSlot = async (id: string) => {
    try {
      const { error } = await supabase.from("tutor_availability").delete().eq("id", id);
      if (error) throw error;
      setSlots(slots.filter(s => s.id !== id));
    } catch (err: any) {
      console.error("Error deleting slot:", err);
      setError("Failed to delete availability slot.");
    }
  };

  if (loading) {
    return <div className="p-4 text-[var(--cs-text-muted)]">Loading availability…</div>;
  }

  return (
    <div className="mt-6 overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      <div className="border-b border-[var(--cs-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--cs-text)]">Tutor availability</h2>
        <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Manage your available hours for one-on-one bookings.</p>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-2 text-sm text-[var(--cs-danger)]">
            {error}
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-end gap-4 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--cs-text-muted)]">Day</label>
            <select
              value={newDay}
              onChange={(e) => setNewDay(Number(e.target.value))}
              className={FIELD_CLASS}
            >
              {DAYS_OF_WEEK.map((day, index) => (
                <option key={index} value={index}>{day}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--cs-text-muted)]">Start time</label>
            <input
              type="time"
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--cs-text-muted)]">End time</label>
            <input
              type="time"
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>
          <Button onClick={handleAddSlot} icon={Plus}>
            Add slot
          </Button>
        </div>

        <div className="space-y-4">
          {DAYS_OF_WEEK.map((dayName, dayIndex) => {
            const daySlots = slots.filter(s => s.dayOfWeek === dayIndex);
            if (daySlots.length === 0) return null;

            return (
              <div key={dayIndex} className="overflow-hidden rounded-[var(--cs-radius-control)] border border-[var(--cs-border)]">
                <div className="border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)] px-4 py-2 font-medium text-[var(--cs-text-muted)]">
                  {dayName}
                </div>
                <ul className="divide-y divide-[var(--cs-border)]">
                  {daySlots.map(slot => (
                    <li key={slot.id} className="flex items-center justify-between px-4 py-3 transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]">
                      <span className="text-sm text-[var(--cs-text)]">
                        {slot.startTime} - {slot.endTime}
                      </span>
                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="rounded-full p-1 text-[var(--cs-danger)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-danger-soft)]"
                        title="Delete slot"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {slots.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--cs-text-muted)]">
              No availability slots configured. Add some above to allow students to book one-on-one sessions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
