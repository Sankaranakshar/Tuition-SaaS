import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Plus, Trash2 } from "lucide-react";

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
    return <div className="p-4 text-[var(--cs-text-muted)]">Loading availability...</div>;
  }

  return (
    <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden mt-6">
      <div className="px-6 py-4 border-b border-[var(--cs-border)]">
        <h2 className="text-lg font-semibold text-[var(--cs-text)]">Tutor Availability</h2>
        <p className="mt-1 text-sm text-[var(--cs-text-muted)]">Manage your available hours for one-on-one bookings.</p>
      </div>
      
      <div className="p-6">
        {error && (
          <div className="mb-4 text-sm text-[var(--cs-danger)] bg-red-50 p-2 rounded-[6px]">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 mb-6 bg-[var(--cs-bg)] p-4 rounded-[6px] border border-[var(--cs-border)]">
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)] mb-1">Day</label>
            <select
              value={newDay}
              onChange={(e) => setNewDay(Number(e.target.value))}
              className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] text-sm outline-none focus:border-[var(--cs-accent)]"
            >
              {DAYS_OF_WEEK.map((day, index) => (
                <option key={index} value={index}>{day}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)] mb-1">Start Time</label>
            <input
              type="time"
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
              className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] text-sm outline-none focus:border-[var(--cs-accent)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)] mb-1">End Time</label>
            <input
              type="time"
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
              className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] text-sm outline-none focus:border-[var(--cs-accent)]"
            />
          </div>
          <button
            onClick={handleAddSlot}
            className="inline-flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Slot
          </button>
        </div>

        <div className="space-y-4">
          {DAYS_OF_WEEK.map((dayName, dayIndex) => {
            const daySlots = slots.filter(s => s.dayOfWeek === dayIndex);
            if (daySlots.length === 0) return null;
            
            return (
              <div key={dayIndex} className="border border-[var(--cs-border)] rounded-[6px] overflow-hidden">
                <div className="bg-[var(--cs-bg)] px-4 py-2 border-b border-[var(--cs-border)] font-medium text-[var(--cs-text-muted)]">
                  {dayName}
                </div>
                <ul className="divide-y divide-[var(--cs-border)]">
                  {daySlots.map(slot => (
                    <li key={slot.id} className="px-4 py-3 flex justify-between items-center hover:bg-[var(--cs-bg)]">
                      <span className="text-sm text-[var(--cs-text)]">
                        {slot.startTime} - {slot.endTime}
                      </span>
                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="text-[var(--cs-danger)] hover:opacity-80 p-1 rounded-full hover:bg-red-50"
                        title="Delete slot"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          
          {slots.length === 0 && (
            <p className="text-sm text-[var(--cs-text-muted)] text-center py-4">
              No availability slots configured. Add some above to allow students to book one-on-one sessions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
