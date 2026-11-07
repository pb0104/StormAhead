import { useState } from "react";
import { AREA_POSTS, NEAR_KM, postsNear, SOCIAL_SOURCE, TAG_LABEL, whenLocal, type Post } from "./real/social.ts";

function PostCard({ p }: { p: Post }) {
  const tags = p.tags.split("; ").filter(Boolean);
  const [broken, setBroken] = useState(false); // deleted posts leave dead image links behind
  const translated = !!p.translation;
  return (
    <article className="post">
      <div className="post-meta"><time>{whenLocal(p)}</time><span>{p.outlet}</span>{p.places && <span>· {p.places}</span>}</div>
      {translated ? (
        <>
          <p>{p.translation}</p>
          <div className="post-tr">English, machine-translated from {p.lang}{p.translator ? ` by ${p.translator}` : ""}</div>
          <blockquote className="post-orig" lang="ne"><span>Original, {p.lang}</span>{p.excerpt}</blockquote>
        </>
      ) : <p>{p.excerpt}</p>}
      {p.image && !broken && (
        <a href={p.url} target="_blank" rel="noreferrer" className="post-img">
          <img src={p.image} alt={`Photo shared with the post: ${p.excerpt}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        </a>
      )}
      {p.image && broken && <p className="muted">Photo no longer available on Reddit.</p>}
      <div className="post-foot">
        {tags.map((t) => <span key={t} className="post-tag">{TAG_LABEL[t] ?? t}</span>)}
        <a href={p.url} target="_blank" rel="noreferrer">Open on Reddit ↗</a>
      </div>
    </article>
  );
}

/** Posts and photos for a spot on the map: real, past posts replayed as a live feed. */
export function SocialFeed({ at, compact = false }: { at: [number, number]; compact?: boolean }) {
  const near = postsNear(at);
  const wider = AREA_POSTS.slice(0, compact ? 3 : 8);
  return (
    <div className="feed">
      <p className="feed-note"><span className="live-dot" aria-hidden="true" />Replay of real posts. {SOCIAL_SOURCE} Tags are keyword-based, not a trained model.</p>
      <h3>At this spot, within {NEAR_KM} km ({near.length})</h3>
      {near.length ? near.map((p) => <PostCard key={p.id} p={p} />) : <p className="muted">No post names a place within {NEAR_KM} km of here.</p>}
      <h3>Across the valley (no precise place)</h3>
      {wider.map((p) => <PostCard key={p.id} p={p} />)}
      <p className="muted">{AREA_POSTS.length} valley-wide posts in total. Newest first.</p>
    </div>
  );
}

/** Panel shown when you click an empty spot on the map. */
export function AreaFeedPanel({ at, onClose }: { at: [number, number] | null; onClose: () => void }) {
  return (
    <aside className={`drawer ${at ? "open" : ""}`} aria-hidden={!at} aria-label="Posts near this spot">
      {at && (
        <>
          <header className="d-head">
            <div style={{ flex: 1 }}>
              <span className="d-kind">Social media · {at[1].toFixed(4)}, {at[0].toFixed(4)}</span>
              <h2>Posts near this spot</h2>
              <span className="prov real">Real posts (Reddit, via Arctic Shift). Places matched by name</span>
            </div>
            <button className="icon" onClick={onClose} aria-label="Close">×</button>
          </header>
          <div className="d-body"><SocialFeed at={at} /></div>
        </>
      )}
    </aside>
  );
}
