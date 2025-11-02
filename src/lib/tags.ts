export function extractTagsFromText(text: string): string[] {
	const tags = new Set<string>();
	if (!text) return [];

	for (const m of text.matchAll(/[#@][a-zA-Z0-9_\-/]+/g)) tags.add(m[0]);
	for (const m of text.matchAll(/```([a-zA-Z0-9_-]+)/g)) tags.add(`lang:${m[1].toLowerCase()}`);
	for (const m of text.matchAll(/\bhttps?:\/\/([a-z0-9.-]+)\b/gi)) tags.add(`dom:${m[1].toLowerCase()}`);
	for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
		const ent = m[1].replace(/\s+/g,'_');
		if (ent.length <= 40) tags.add(`ent:${ent}`);
	}
	return Array.from(tags).slice(0, 24);
}

export function aggregateConvTags(messages: { text: string }[]): string[] {
	const all = new Set<string>();
	for (const m of messages) {
		for (const t of extractTagsFromText(m.text || '')) all.add(t);
	}
	return Array.from(all);
}






