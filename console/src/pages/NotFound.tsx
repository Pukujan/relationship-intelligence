import { Link } from "react-router-dom";
import { ArrowLeft, Compass, Sparkles } from "lucide-react";
import { useOrchestrator } from "@/components/copilot/OrchestratorProvider";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const { openCopilot } = useOrchestrator();

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="panel w-full max-w-md p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted-foreground">
          <Compass className="h-5 w-5" />
        </div>
        <p className="eyebrow mt-4">404 · off the map</p>
        <h1 className="mt-1.5 text-[20px] font-semibold">
          That surface doesn't exist
        </h1>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          The route is gone, but the graph is intact. Head back to Mission
          Control or ask the copilot where to go next.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="gap-1.5 rounded-lg" asChild>
            <Link to="/">
              <ArrowLeft className="h-3.5 w-3.5" />
              Mission Control
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 rounded-lg"
            onClick={() => openCopilot("What can the team do for me today?")}
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Ask the copilot
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
