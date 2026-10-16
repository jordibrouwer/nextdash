<?php
/**
 * The homepage (layout A): the sentence and the screenshot, then quick start,
 * the three pillars, what else is on board, integrations, your data and the
 * latest release. The words live here; the page in WordPress only gives the
 * front page its place.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

$links   = ndw_links();
$release = ndw_latest_release();
$docs    = function ( $page ) {
	return esc_url( home_url( '/docs/' . $page ) );
};
$compose = "services:\n  nextdash:\n    image: ghcr.io/jordibrouwer/nextdash:latest\n    ports: [\"8080:8080\"]\n    volumes: [\"./data:/app/data\"]\n    restart: unless-stopped";
?>
<section class="nd-hero nd-hero--live">
	<div class="nd-wrap nd-hero-row">
		<div class="nd-hero-text">
			<h1><?php echo esc_html( ndw_tagline() ); ?></h1>
			<p class="nd-sub">Keyboard-first. No accounts, no cloud. One container and a folder of plain JSON.</p>
			<p class="nd-btns">
				<a class="nd-btn nd-btn--primary" href="<?php echo $docs( 'installation.html' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">Install</a>
				<a class="nd-btn" href="<?php echo esc_url( $links['demo'] ); ?>" rel="noopener">Live demo <span aria-hidden="true">↗</span></a>
				<a class="nd-btn" href="<?php echo esc_url( home_url( '/features/' ) ); ?>">Features</a>
			</p>
		</div>
		<?php echo ndw_hero_shot(); // phpcs:ignore WordPress.Security.EscapeOutput ?>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<ul class="nd-stats" data-nd-stats aria-label="nextDash in numbers">
			<?php foreach ( ndw_stats() as $s ) : ?>
				<li><b data-to="<?php echo (int) $s[0]; ?>"<?php echo $s[0] >= 1000 ? ' data-sep' : ''; ?>><?php echo esc_html( number_format( $s[0] ) ); ?></b><span><?php echo esc_html( $s[1] ); ?></span></li>
			<?php endforeach; ?>
		</ul>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<p class="nd-label">Quick start</p>
		<div class="nd-split">
			<div class="nd-term">
				<div class="nd-term-bar" aria-hidden="true"><i></i><i></i><i></i></div>
				<?php
				$term_out = array( '[+] Pulling 1/1', '✔ nextdash Pulled', '[+] Running 2/2', '✔ Network nextdash_default  Created', '✔ Container nextdash         Started', '', '$ open http://your-server:8080' );
				?>
				<pre data-nd-term data-cmd="docker compose up -d" data-out="<?php echo esc_attr( wp_json_encode( $term_out ) ); ?>"><span class="p">$</span> docker compose up -d
<?php echo esc_html( implode( "\n", $term_out ) ); ?></pre>
			</div>
			<div>
				<h2>One container, one folder.</h2>
				<p><code>docker compose up -d</code> and open <code>http://your-server:8080</code>. Your bookmarks are plain JSON in <code>./data</code>.</p>
				<details class="nd-compose">
					<summary>Show compose.yaml</summary>
					<pre><code><?php echo esc_html( $compose ); ?></code></pre>
				</details>
				<p class="nd-muted">On Unraid: <a href="<?php echo esc_url( $links['unraid'] ); ?>" rel="noopener">Community Applications</a>. Behind a reverse proxy, with the Docker socket, or from source: <a href="<?php echo $docs( 'installation.html' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">Installation</a>.</p>
			</div>
		</div>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<p class="nd-label">What it does</p>
		<div class="nd-mcards">
			<?php
			echo ndw_motion_card( 'health', 'Bookmarks with health', 'Every link checked on a schedule: uptime over 30 days, response times, certificate expiry, dead links and pages that turn into something else.', home_url( '/features/health/' ), 'Health →' ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_motion_card( 'containers', 'Your Docker host', 'Containers next to the bookmarks for them. Start, stop and follow logs from the keyboard; updates in a nightly window that roll back when a container fails.', home_url( '/features/containers/' ), 'Containers →' ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_motion_card( 'keys', 'Keyboard-first', 'Search, open, edit and move everything without the mouse. Press <kbd>!</kbd> for every key on the page you are on.', home_url( '/features/keys/' ), 'Keys →' ); // phpcs:ignore WordPress.Security.EscapeOutput
			?>
		</div>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<p class="nd-label">Also on board</p>
		<div class="nd-also">
			<div><b>Widgets</b><span>Uptime, certificates, the weather, your calendar, feeds, and any service that answers with JSON.</span></div>
			<div><b>Looks</b><span>328 themes, each with a light and a dark half, and a look studio that changes the real page.</span></div>
			<div><b>Capture</b><span>Save a link from a browser extension, a share sheet, a bookmarklet or a shell one-liner.</span></div>
			<div><b>Inbox</b><span>New links land in an inbox to sort later, with tag suggestions.</span></div>
			<div><b>Alerts</b><span>A site that goes down or a container that crashes reaches you through ntfy, Pushover, Gotify, Telegram and more.</span></div>
			<div><b>Six languages</b><span>English, Dutch, German, French, Spanish and Chinese.</span></div>
		</div>
		<p class="nd-more"><a href="<?php echo esc_url( home_url( '/features/' ) ); ?>">All features →</a></p>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<p class="nd-label">Works with</p>
		<p class="nd-integr">Jellyfin · Emby · Plex · Sonarr · Radarr · Seerr · qBittorrent · SABnzbd · Home Assistant · Unraid · Pi-hole · Proxmox · ntfy · Pushover · Gotify · Telegram · Discord · Apprise · <a href="<?php echo $docs( 'widgets.html' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">all integrations →</a></p>
	</div>
</section>

<section class="nd-sec nd-reveal">
	<div class="nd-wrap">
		<p class="nd-label">Your data</p>
		<div class="nd-three">
			<div><h3>No accounts</h3><p>One installation, one set of data on disk. Nothing to sign up for.</p></div>
			<div><h3>Plain files</h3><p>Bookmarks and settings are JSON in one folder you back up and move like any other.</p></div>
			<div><h3>What leaves the server</h3><p>Analytics only if you switch them on. A daily install count, a release check and the news feed, each with its own switch. <a href="<?php echo $docs( 'security-and-self-hosting.html' ); // phpcs:ignore WordPress.Security.EscapeOutput ?>">Details →</a></p></div>
		</div>
	</div>
</section>

<?php if ( $release ) : ?>
	<?php
	$post = ndw_release_post( $release['version'] );
	$date = $release['date'] ? wp_date( 'j F Y', strtotime( $release['date'] ) ) : '';
	?>
	<section class="nd-sec">
		<div class="nd-wrap nd-release">
			<div>
				<p class="nd-label">Latest release</p>
				<p class="nd-version"><?php echo esc_html( $release['version'] ); ?></p>
				<?php if ( $date ) : ?><p class="nd-muted"><?php echo esc_html( $date ); ?></p><?php endif; ?>
			</div>
			<div>
				<?php if ( $post ) : ?>
					<p class="nd-release-title"><a href="<?php echo esc_url( get_permalink( $post ) ); ?>"><?php echo esc_html( get_the_title( $post ) ); ?></a></p>
					<p class="nd-muted"><?php echo esc_html( wp_trim_words( wp_strip_all_tags( get_the_excerpt( $post ) ), 40 ) ); ?></p>
				<?php endif; ?>
				<p class="nd-links">
					<a href="<?php echo esc_url( $release['url'] ); ?>" rel="noopener">Release notes</a> ·
					<a href="<?php echo esc_url( $links['changelog'] ); ?>" rel="noopener">Changelog</a> ·
					<a href="<?php echo esc_url( home_url( '/news/' ) ); ?>">All news</a>
				</p>
			</div>
		</div>
	</section>
<?php endif; ?>
<?php
get_footer();
