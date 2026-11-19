import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useData } from "@/data/store";
import type { Decision } from "@/data/types";

export const useApprovalDecision = () => {
  const { decide } = useData();
  const navigate = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const act = useCallback(
    async (
      approvalId: string,
      decision: Decision,
      options?: { note?: string; editedAction?: string; title?: string },
    ) => {
      setPendingId(approvalId);
      try {
        const result = await decide({
          approvalId,
          decision,
          note: options?.note,
          editedAction: options?.editedAction,
        });
        toast.success(
          decision === "approved" ? "Approved" : "Declined",
          {
            description:
              decision === "approved"
                ? `${result.agent.name} is executing now. Logged to the timeline.`
                : `${result.agent.name} will stop this thread. Logged to the timeline.`,
            action: {
              label: "View timeline",
              onClick: () => navigate("/activity"),
            },
          },
        );
        return result;
      } catch (error) {
        toast.error("That decision could not be recorded", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        return null;
      } finally {
        setPendingId(null);
      }
    },
    [decide, navigate],
  );

  return { act, pendingId };
};
