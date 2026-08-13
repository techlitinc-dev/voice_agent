import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { computeForecast, type PipelineBoardDeal } from "@/lib/crm";

/** Revenue forecast by stage probability (guide crm/02 §6). */
export function Forecast({
  stages,
  dealsByStage,
}: {
  stages: { id: string; name: string; probability: number }[];
  dealsByStage: Record<string, PipelineBoardDeal[]>;
}) {
  const { rows, totalPipeline, totalWeighted } = computeForecast(stages, dealsByStage);

  return (
    <Card data-testid="forecast-card">
      <CardHeader>
        <CardTitle className="text-sm">Revenue forecast</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1">Stage</th>
              <th className="py-1 text-right">Value</th>
              <th className="py-1 text-right">×Prob</th>
              <th className="py-1 text-right">Weighted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stageId} className="border-b last:border-0">
                <td className="py-1">{r.stage}</td>
                <td className="py-1 text-right">{formatINR(r.value)}</td>
                <td className="py-1 text-right text-muted-foreground">{r.probability}%</td>
                <td className="py-1 text-right font-medium">{formatINR(r.weighted)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="pt-2">Total (pipeline)</td>
              <td className="pt-2 text-right">{formatINR(totalPipeline)}</td>
              <td className="pt-2" />
              <td className="pt-2 text-right text-primary">{formatINR(totalWeighted)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
