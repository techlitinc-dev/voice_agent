/** All money in this codebase is integer paise (1 INR = 100 paise). Never floats. */

export function paiseToRupees(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(paise / 100);
}

/** Apply our markup % to a wholesale cost. */
export function withMarkup(costPaise: number, markupPercent: number): number {
  return Math.round(costPaise * (1 + markupPercent / 100));
}

/** Per-second call billing: bill ceil(seconds * perMinutePaise / 60). */
export function billForSeconds(seconds: number, perMinutePaise: number): number {
  if (seconds <= 0) return 0;
  return Math.ceil((seconds * perMinutePaise) / 60);
}

/**
 * Split GST on a taxable base amount (GST rate 18% by default).
 * Intra-state supply → CGST + SGST (9% + 9%); inter-state → IGST (18%).
 * cgst/sgst are split with floor/remainder so cgst + sgst always equals the total.
 */
export function splitGst(
  basePaise: number,
  interState: boolean,
  ratePercent = 18,
): { cgstPaise: number; sgstPaise: number; igstPaise: number; totalGstPaise: number } {
  const totalGstPaise = Math.round((basePaise * ratePercent) / 100);
  if (interState) {
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: totalGstPaise, totalGstPaise };
  }
  const cgstPaise = Math.floor(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise;
  return { cgstPaise, sgstPaise, igstPaise: 0, totalGstPaise };
}

/** Total wholesale cost of a call from its 4 components. */
export function callCostPaise(parts: {
  telephonyPaise: number;
  sttPaise: number;
  llmPaise: number;
  ttsPaise: number;
}): number {
  return parts.telephonyPaise + parts.sttPaise + parts.llmPaise + parts.ttsPaise;
}
