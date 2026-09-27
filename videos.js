// Keep playback user-controlled and media unloaded until it is requested.
const demoPlayers = [...document.querySelectorAll('.video-player')];
const formatVideoTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
for (const player of demoPlayers) {
  const video = player.querySelector('video');
  const controls = player.querySelector('.video-controls');
  const toggle = player.querySelector('.video-toggle');
  const seek = player.querySelector('.video-seek');
  const time = player.querySelector('.video-time');
  const fullscreen = player.querySelector('.video-fullscreen');
  const error = player.querySelector('.video-error');
  const title = video.getAttribute('aria-label');
  let seeking = false, pendingSeek = null;
  const duration = () => Number.isFinite(video.duration) ? video.duration : Number(video.dataset.duration);
  const sync = () => {
    player.classList.toggle('is-playing', !video.paused && !video.ended);
    toggle.setAttribute('aria-label', `${video.ended ? 'Replay' : video.paused ? 'Play' : 'Pause'} ${title}`);
    seek.max = duration();
    if (!seeking) seek.value = video.currentTime;
    seek.style.setProperty('--played', `${100 * Number(seek.value) / duration()}%`);
    seek.setAttribute('aria-valuetext', `${formatVideoTime(Number(seek.value))} of ${formatVideoTime(duration())}`);
    time.textContent = `${formatVideoTime(video.currentTime)} / ${formatVideoTime(duration())}`;
  };
  const play = async () => {
    try { await video.play(); error.hidden = true; }
    catch (e) { if (e.name !== 'AbortError') error.hidden = false; }
  };
  toggle.addEventListener('click', () => {
    if (video.paused || video.ended) { if (video.ended) video.currentTime = 0; play(); }
    else video.pause();
  });
  video.addEventListener('click', () => toggle.click());
  video.addEventListener('play', () => {
    for (const other of demoPlayers) if (other !== player) other.querySelector('video').pause();
    if (window.viewerState?.().playing) document.getElementById('play').click();
    sync();
  });
  for (const event of ['pause', 'ended', 'timeupdate', 'durationchange']) video.addEventListener(event, sync);
  video.addEventListener('loadedmetadata', () => {
    if (pendingSeek !== null) { video.currentTime = Math.min(pendingSeek, duration()); pendingSeek = null; }
    sync();
  });
  video.addEventListener('error', () => { error.hidden = false; });
  seek.addEventListener('input', () => {
    seeking = true;
    const target = Number(seek.value);
    seek.style.setProperty('--played', `${100 * target / duration()}%`);
    if (video.readyState === 0) { pendingSeek = target; video.load(); }
    else video.currentTime = target;
    time.textContent = `${formatVideoTime(target)} / ${formatVideoTime(duration())}`;
    seek.setAttribute('aria-valuetext', `${formatVideoTime(target)} of ${formatVideoTime(duration())}`);
  });
  seek.addEventListener('change', () => { seeking = false; });
  fullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.requestFullscreen) await player.requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else { video.controls = true; controls.hidden = true; }
    } catch { video.controls = true; controls.hidden = true; }
  });
  controls.hidden = false;
  video.controls = false;
  sync();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) for (const player of demoPlayers) player.querySelector('video').pause();
});
