import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useData } from "@/data/store";
import type { Decision, DeclinePath } from "@/data/types";

export const useApprovalDecision = () => {
  const { decide } = useData();
  const navigate = useNavigate();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const act = useCallback(
    async (
      approvalId: string,
      decision: Decision,
      options?: {
        note?: string;
        editedAction?: string;
        title?: string;
        declinePath?: DeclinePath;
      },
    ) => {
      setPendingId(approvalId);
      try {
        const result = await decide({
          approvalId,
          decision,
          declinePath: options?.declinePath,
          note: options?.note,
          editedAction: options?.editedAction,
        });
        const declineText =
          options?.declinePath === "re_plan"
            ? `${result.agent.name} queued a fresh re-plan proposal.`
            : options?.declinePath === "snooze"
              ? "Snoozed for 24 hours."
              : `${result.agent.name} stopped this thread — no mission created.`;
        toast.success(
          decision === "approved"
            ? "Approved"
            : options?.declinePath === "snooze"
              ? "Snoozed"
              : "Declined",
          {
            description:
              decision === "approved"
                ? `${result.agent.name} is executing now. Logged to the timeline.`
                : declineText,
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
