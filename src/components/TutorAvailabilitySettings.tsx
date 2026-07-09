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
    return <div className="p-4 text-gray-500">Loading availability...</div>;
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-6">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Tutor Availability</h2>
        <p className="mt-1 text-sm text-gray-500">Manage your available hours for one-on-one bookings.</p>
      </div>
      
      <div className="p-6">
        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-4 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Day</label>
            <select
              value={newDay}
              onChange={(e) => setNewDay(Number(e.target.value))}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              {DAYS_OF_WEEK.map((day, index) => (
                <option key={index} value={index}>{day}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
            <input
              type="time"
              value={newStartTime}
              onChange={(e) => setNewStartTime(e.target.value)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
            <input
              type="time"
              value={newEndTime}
              onChange={(e) => setNewEndTime(e.target.value)}
              className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <button
            onClick={handleAddSlot}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
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
              <div key={dayIndex} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 font-medium text-gray-700">
                  {dayName}
                </div>
                <ul className="divide-y divide-gray-200">
                  {daySlots.map(slot => (
                    <li key={slot.id} className="px-4 py-3 flex justify-between items-center hover:bg-gray-50">
                      <span className="text-sm text-gray-900">
                        {slot.startTime} - {slot.endTime}
                      </span>
                      <button
                        onClick={() => handleDeleteSlot(slot.id)}
                        className="text-red-600 hover:text-red-900 p-1 rounded-full hover:bg-red-50"
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
            <p className="text-sm text-gray-500 text-center py-4">
              No availability slots configured. Add some above to allow students to book one-on-one sessions.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
