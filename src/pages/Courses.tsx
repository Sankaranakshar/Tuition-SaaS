import { useState, useEffect, type FormEvent } from "react";
import { BookOpen, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { EmptyState, SkeletonRow } from "../components/kit";

interface Course {
  id: string;
  name: string;
  createdAt: string;
}

function rowToCourse(row: any): Course {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

// Tech Debt #19 (DEV_PLAN.md): the only thing that ever inserted into
// `courses` was a manual Supabase Table Editor row — the Add Class dropdown
// in Calendar.tsx reads the table but nothing in the app wrote to it. This is
// the minimal write path: a name-only create form plus a delete affordance.
// `courses_write` RLS requires org-admin, matching class_templates_write.
export default function Courses() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!user || !user.organizationId) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, name, created_at")
        .eq("organization_id", user.organizationId)
        .order("name", { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) console.error("Supabase Error (Courses): ", error);
      else setCourses((data || []).map(rowToCourse));
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel(`courses-${user.organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "courses", filter: `organization_id=eq.${user.organizationId}` }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const closeModal = () => {
    setIsModalOpen(false);
    setName("");
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !user.organizationId || !name.trim()) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("courses").insert({
        organization_id: user.organizationId,
        name: name.trim(),
      });
      if (error) throw error;
      toast.success("Course added");
      closeModal();
    } catch (error: any) {
      toast.error("Could not add course", { description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (course: Course) => {
    try {
      const { error } = await supabase.from("courses").delete().eq("id", course.id);
      if (error) throw error;
      toast.success("Course removed");
    } catch (error: any) {
      toast.error("Could not remove course", { description: error.message });
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cs-text)]">Courses</h1>
          <p className="mt-0.5 text-sm text-[var(--cs-text-muted)]">
            Courses populate the "Course" dropdown when scheduling a class in the Calendar.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--cs-accent)] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
          New course
        </button>
      </div>

      {loading ? (
        <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : courses.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses yet"
          description="Add a course before scheduling a class — the Calendar's Add Class dropdown pulls from this list."
          action={{ label: "New course", onClick: () => setIsModalOpen(true) }}
        />
      ) : (
        <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          {courses.map((course) => (
            <div key={course.id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-medium text-[var(--cs-text)]">{course.name}</span>
              <button
                onClick={() => handleDelete(course)}
                className="text-xs text-[var(--cs-text-muted)] hover:text-[var(--cs-danger,#dc2626)]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--cs-border)] px-5 py-4">
              <h3 className="text-sm font-semibold text-[var(--cs-text)]">New course</h3>
              <button onClick={closeModal} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="px-5 py-4">
                <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">Course name</label>
                <input
                  autoFocus
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Grade 10 Mathematics"
                  className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-3 py-2 text-sm text-[var(--cs-text)] focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--cs-border)] px-5 py-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-[6px] border border-[var(--cs-border)] px-3.5 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-[var(--cs-bg)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !name.trim()}
                  className="rounded-[6px] bg-[var(--cs-accent)] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  Add course
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
