<?php
/**
 * Adds the feature pages whose pictures exist but whose page did not:
 * media widgets, tags and appearance. Run inside the WordPress container:
 *
 *   docker cp add-feature-pages.php <container>:/tmp/afp.php
 *   docker exec -e ND_HOST=nextdash.cc <container> php /tmp/afp.php
 *
 * A page that already exists (by slug, under Features) is left alone, so the
 * script can run twice. Pages go up as drafts unless ND_PUBLISH=1 is set.
 */

// Without a host, wp-config's redirect ends the script before it starts.
$_SERVER['HTTP_HOST'] = getenv( 'ND_HOST' ) ?: 'localhost';
chdir( '/var/www/html' );
require '/var/www/html/wp-load.php';

$parent = get_page_by_path( 'features' );
if ( ! $parent ) {
	fwrite( STDERR, "No Features page.\n" );
	exit( 1 );
}
$status = getenv( 'ND_PUBLISH' ) ? 'publish' : 'draft';

$pages = array(
	array(
		'slug'    => 'media-widgets',
		'title'   => 'Media widgets',
		'meta'    => array(
			'ndt_feature_group'   => 'selfhost',
			'ndt_feature_order'   => '2',
			'ndt_feature_blurb'   => 'What was added, what is coming and what is playing, from your own servers.',
			'ndt_feature_thumb'   => 'media-widgets/poster.jpg',
			'ndt_feature_video'   => 'media-widgets',
			'ndt_feature_related' => 'widgets,custom-widgets,unraid',
			'ndt_feature_since'   => '1.19.5',
		),
		'content' => '<p>Media widgets put your media servers on the dashboard, with the posters from your own library. Jellyfin, Emby and Plex (read through Tautulli) show what was added lately. Their now-playing tiles show who is watching what, and how far along they are.</p>'
			. '<p>Sonarr and Radarr show the episodes and films coming up in the next days, and what is downloading. Seerr shows the requests in Overseerr or Jellyseerr, with who asked and whether they arrived.</p>'
			. '<p>The keys stay on the nextDash server. The tiles and their posters come through it, so the browser never talks to your media servers. When a server cannot be reached, its tile keeps the last list and says how old it is.</p>'
			. '<h2>Try it</h2><ol><li>Open Config, then Widgets, and add a widget to a page: Jellyfin, Sonarr, Seerr or another media kind.</li><li>Fill in the server\'s address and its API key, and press Connect.</li><li>Choose a layout: list, strip, hero or grid.</li></ol>'
			. '[nd_shot src="media-widgets/shot-1.jpg" alt="Now playing, recently added, requests and Radarr on one page" caption="Now playing, recently added, requests and Radarr, read from real servers."]'
			. '<h2>Downloads and the house</h2><p>qBittorrent and SABnzbd show what is downloading, paused and done, with progress, speed and time left, as one list or a tab per part. Home Assistant shows the entities you choose, and switches lights, switches and scenes from the tile.</p>'
			. '[nd_shot src="media-widgets/shot-2.jpg" alt="qBittorrent, SABnzbd and Home Assistant tiles" caption="qBittorrent, SABnzbd and Home Assistant."]',
	),
	array(
		'slug'    => 'tags',
		'title'   => 'Tags',
		'meta'    => array(
			'ndt_feature_group'   => 'basics',
			'ndt_feature_order'   => '5',
			'ndt_feature_blurb'   => 'Free labels, a view per tag, and suggestions that wait for your click.',
			'ndt_feature_thumb'   => 'tags/poster.jpg',
			'ndt_feature_video'   => 'tags',
			'ndt_feature_related' => 'find,collections,inbox',
			'ndt_feature_keys'    => "/ | Open the tag cloud\nShift+T | Tag the selected bookmark",
		),
		'content' => '<p>Tags are free labels on your bookmarks, stored in lower case. Add them in the bookmark form, or select a bookmark and press Shift + T.</p>'
			. '<p>Every tag has a view of its own: all bookmarks with that tag, from every page, in one table. The header says how many there are, on how many pages, and what was opened last and most. The rail beside it lists related tags, the pages they live on and a health filter. From there you open them all, copy their links or rename the tag.</p>'
			. '<h2>Try it</h2><ol><li>Press / for the tag cloud. The tags you use most are largest.</li><li>Click a tag to open its view. Shift-click another to add its bookmarks.</li><li>Press Escape to go back to the page you came from.</li></ol>'
			. '[nd_shot src="tags/shot-1.jpg" alt="The tag view for #dev" caption="The view for #dev: seven bookmarks on two pages."]'
			. '<h2>Suggestions you approve</h2><p>nextDash proposes tags for bookmarks that lack them. It never tags anything behind your back: every suggestion waits for a click. Suggestions come from rules you write, from the tags you already use on a site, from self-hosted apps it recognises by name, and from a catalogue of 645 subjects and some 81,000 sites that ships with the app.</p>'
			. '<p>A suggestion speaks your words. If your GitHub links carry #code, a new one is offered #code, not #dev. For a public site the catalogue does not know, the server can ask Wikidata. Only the host name leaves the server, and an address on your own network never does.</p>'
			. '[nd_shot src="tags/shot-2.jpg" alt="The Bookmarks view with tag suggestions" caption="Suggested tags wait in the rows, with Add all for the lot."]',
	),
	array(
		'slug'    => 'appearance',
		'title'   => 'Appearance',
		'meta'    => array(
			'ndt_feature_group'   => 'basics',
			'ndt_feature_order'   => '3',
			'ndt_feature_blurb'   => 'Every setting for the look, in nine tabs, with a preview that follows along.',
			'ndt_feature_thumb'   => 'appearance/poster.jpg',
			'ndt_feature_video'   => 'appearance',
			'ndt_feature_related' => 'looks,themes,keys',
			'ndt_feature_keys'    => '&lt; | Open config, where Appearance lives',
			'ndt_feature_since'   => '1.19.7',
		),
		'content' => '<p>Config, then Appearance, holds everything about how the dashboard looks. Nine tabs stand under three labels: Look (theme and type, background, surfaces), Bookmarks (layout, rows, link previews) and Header and bars (header, action bar, date and weather).</p>'
			. '<p>On each tab the first panel is open. The others fold to one line that says what they are set to, with changed values first. Beside the settings stands a small drawing of your dashboard, which follows every change as you make it.</p>'
			. '<h2>Try it</h2><ol><li>Open Config and choose Appearance.</li><li>Pick a tab, for example Background, and change a setting. The preview and the dashboard follow at once.</li><li>Fold a panel open to see all of its settings.</li></ol>'
			. '[nd_shot src="appearance/shot-1.jpg" alt="The Background tab of Appearance with the preview beside it" caption="The Background tab, with the preview on the right."]'
			. '<h2>Find what you changed</h2><p>Only changed keeps the settings that differ from the default, and the line above the tabs counts them. The filter finds a setting by name, and every panel can be reset on its own.</p>'
			. '[nd_shot src="appearance/shot-2.jpg" alt="The Action bar tab with Only changed on" caption="Only changed: one of sixteen settings on this tab differs from the default."]',
	),
);

foreach ( $pages as $p ) {
	$existing = get_page_by_path( 'features/' . $p['slug'] );
	if ( $existing ) {
		echo "{$p['slug']}: exists (#{$existing->ID}), left alone\n";
		continue;
	}
	$id = wp_insert_post(
		array(
			'post_type'    => 'page',
			'post_status'  => $status,
			'post_parent'  => $parent->ID,
			'post_name'    => $p['slug'],
			'post_title'   => $p['title'],
			'post_content' => $p['content'],
			'page_template' => 'page-feature.php',
		),
		true
	);
	if ( is_wp_error( $id ) ) {
		fwrite( STDERR, "{$p['slug']}: " . $id->get_error_message() . "\n" );
		continue;
	}
	foreach ( $p['meta'] as $key => $value ) {
		update_post_meta( $id, $key, $value );
	}
	echo "{$p['slug']}: added as {$status} (#{$id})\n";
}
