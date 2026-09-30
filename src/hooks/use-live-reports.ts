import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchReports } from "@/lib/reports";
import { supabase } from "@/integrations/supabase/client";

export function useLiveReports(limit = 200, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["reports", limit],
    queryFn: () => fetchReports(limit),
    enabled,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`reports-sync-${limit}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "reports" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["reports"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, limit, queryClient]);

  return query;
}
