import { useEffect, useMemo, useState } from "react";

export type PageSize = number | "all";

export function usePagination<T>(
  items: readonly T[],
  opts?: { defaultPageSize?: PageSize; persistKey?: string; currentFilterHash?: string }
) {
  const persistKey = opts?.persistKey ?? "aip.pageSize";

  const [pageSize, setPageSize] = useState<PageSize>(() => {
    const v = window.localStorage.getItem(persistKey);
    if (v === "all") return "all";
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? (n as PageSize) : (opts?.defaultPageSize ?? 50);
  });

  const [page, setPage] = useState(1);

  // persist pageSize
  useEffect(() => {
    window.localStorage.setItem(persistKey, pageSize === "all" ? "all" : String(pageSize));
  }, [pageSize, persistKey]);

  // reset to page 1 on filter change
  useEffect(() => { 
    setPage(1); 
  }, [opts?.currentFilterHash]);

  const total = items.length;

  const pageCount = useMemo(() => {
    if (pageSize === "all") return total ? 1 : 0;
    return Math.max(1, Math.ceil(total / (pageSize as number)));
  }, [total, pageSize]);

  // clamp
  useEffect(() => { 
    if (page > pageCount) setPage(pageCount || 1); 
  }, [page, pageCount]);

  const paged = useMemo(() => {
    if (pageSize === "all") return items;
    const sz = pageSize as number;
    const start = (page - 1) * sz;
    return items.slice(start, start + sz);
  }, [items, page, pageSize]);

  return {
    page, setPage, pageCount,
    pageSize, setPageSize,
    total,
    paged,
    gotoFirst: () => setPage(1),
    gotoLast: () => setPage(pageCount || 1),
    next: () => setPage(p => Math.min(p + 1, pageCount)),
    prev: () => setPage(p => Math.max(p - 1, 1)),
  };
}
