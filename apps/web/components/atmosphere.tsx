export function Atmosphere() {
  return (
    <div className="atmosphere" aria-hidden>
      <div className="atmosphere-vignette" />
      <div className="atmosphere-grid" />
      <div className="atmosphere-orb a" />
      <div className="atmosphere-orb b" />
      <div className="atmosphere-scan" />
      <div className="hud-chrome">
        <span className="hud-corner tl" />
        <span className="hud-corner tr" />
        <span className="hud-corner bl" />
        <span className="hud-corner br" />
        <span className="hud-rail left" />
        <span className="hud-rail right" />
      </div>
    </div>
  );
}
