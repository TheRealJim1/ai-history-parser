export function matchesQuery(title:string, body:string, q:string, regex:boolean): boolean {
  const query = (q ?? '').trim();
  if (!query) return true;          // ← key fix
  if (regex) {
    try { return new RegExp(query,'i').test(title) || new RegExp(query,'i').test(body); }
    catch { return false; }
  }
  return (title+ ' ' + body).toLowerCase().includes(query.toLowerCase());
}







