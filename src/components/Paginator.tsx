import React from "react";
import { PageSize } from "../hooks/usePagination";

export const Paginator: React.FC<{
  page: number; 
  pageCount: number;
  pageSize: PageSize; 
  setPageSize: (v: PageSize) => void;
  total: number;
  gotoFirst(): void; 
  gotoLast(): void; 
  next(): void; 
  prev(): void;
}> = ({ page, pageCount, pageSize, setPageSize, total, gotoFirst, gotoLast, next, prev }) => {
  const sizes: PageSize[] = [25, 50, 100, 250, 500, "all"];

  return (
    <div className="aip-pager">
      <div className="aip-pager-left">
        <button className="aip-btn" onClick={gotoFirst} disabled={page <= 1}>⏮</button>
        <button className="aip-btn" onClick={prev} disabled={page <= 1}>◀</button>
        <span className="aip-pg-label">Page {page} / {Math.max(pageCount, 1)}</span>
        <button className="aip-btn" onClick={next} disabled={page >= pageCount}>▶</button>
        <button className="aip-btn" onClick={gotoLast} disabled={page >= pageCount}>⏭</button>
      </div>
      <div className="aip-pager-right">
        <span className="aip-pg-label">{total.toLocaleString()} results</span>
        <select
          className="aip-select"
          value={String(pageSize)}
          onChange={e => setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))}
          title="Items per page"
        >
          {sizes.map(s => (
            <option key={String(s)} value={String(s)}>
              {s === "all" ? "All" : `${s}/page`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
