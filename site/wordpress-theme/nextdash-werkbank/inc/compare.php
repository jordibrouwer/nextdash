<?php
/**
 * The comparison on /compare/: nextDash next to six self-hosted dashboards.
 * Facts come from each project's own docs, README, compose file or source,
 * checked on the date below; a point the sources do not settle is "not
 * documented", never "no".
 *
 * A cell is [ mark, note ]: y (yes), p (partly), n (no), u (not documented),
 * x (not what the tool is for). A text cell is a plain string.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

/** When the facts were last checked against the sources. */
function ndw_compare_checked() {
	return '17 October 2026';
}

/** The tools, nextDash first. */
function ndw_compare_tools() {
	return array(
		'nextdash' => array( 'name' => 'nextDash', 'kind' => 'Start page and bookmarks', 'url' => 'https://github.com/jordibrouwer/nextdash', 'release' => 'v1.19.8, 15 Oct 2026' ),
		'homarr'   => array( 'name' => 'Homarr', 'kind' => 'Dashboard', 'url' => 'https://github.com/homarr-labs/homarr', 'release' => 'v2.6.0, 15 Oct 2026' ),
		'homepage' => array( 'name' => 'Homepage', 'kind' => 'Dashboard', 'url' => 'https://github.com/gethomepage/homepage', 'release' => 'v2.6.0, 17 Oct 2026' ),
		'glance'   => array( 'name' => 'Glance', 'kind' => 'Dashboard and feeds', 'url' => 'https://github.com/glanceapp/glance', 'release' => 'v0.8.7, 15 Oct 2026' ),
		'dashy'    => array( 'name' => 'Dashy', 'kind' => 'Dashboard', 'url' => 'https://github.com/Lissy93/dashy', 'release' => '4.8.0, 9 Oct 2026' ),
		'heimdall' => array( 'name' => 'Heimdall', 'kind' => 'Application launcher', 'url' => 'https://github.com/linuxserver/Heimdall', 'release' => 'v2.8.3, 5 Sep 2026' ),
		'homer'    => array( 'name' => 'Homer', 'kind' => 'Static dashboard', 'url' => 'https://github.com/bastienwirtz/homer', 'release' => 'v26.08.3, 30 Aug 2026' ),
	);
}

/** The rows, by group: label => cells in the order of the tools. */
function ndw_compare_rows() {
	$u = array( 'u', '' );
	return array(
		'Running it'   => array(
			'Stores its data in'  => array( 'plain JSON files', 'SQLite or PostgreSQL', 'its config files', 'its config file', 'its config file', 'SQLite by default', 'its config file' ),
			'Containers'          => array( '1', '1', '1', '1', '1', '1', '1' ),
			'People'              => array( 'one, no accounts', 'users and groups, OIDC and LDAP', 'an optional password or OIDC login', 'an optional login, several users', 'an optional login, several users, OIDC', 'several users, optional passwords', 'a static site; it works behind an authentication proxy' ),
			'Licence'             => array( 'MIT', 'Apache-2.0', 'GPL-3.0', 'AGPL-3.0', 'MIT', 'MIT', 'Apache-2.0' ),
			'Memory it asks for'  => array( 'about 60 MB idle; the sample compose sets a 256 MB limit', 'at least 500 MB', $u, 'low; one binary under 20 MB', '256 MB is enough', $u, $u ),
		),
		'Saving links' => array(
			'Add and edit in the browser' => array( array( 'y', '' ), array( 'y', 'drag and drop, no YAML' ), array( 'n', 'YAML files' ), array( 'n', 'a YAML file, reloaded on change' ), array( 'y', 'a built-in editor, or YAML' ), array( 'y', '' ), array( 'n', 'a YAML file' ) ),
			'A bookmark library (tags, inbox, link health)' => array( array( 'y', 'tags, an inbox, scheduled link checks' ), array( 'p', 'a bookmarks widget' ), array( 'p', 'lists of links' ), array( 'p', 'a bookmarks widget' ), array( 'p', 'sections of links, tags for search' ), array( 'p', 'tags and pinned apps' ), array( 'p', 'grouped links with keywords' ) ),
			'On a phone'          => array( array( 'y', 'installable web app, share sheet' ), $u, array( 'y', 'installable web app' ), array( 'y', 'made for small screens' ), array( 'y', 'responsive, installable web app' ), $u, array( 'y', 'installable web app' ) ),
		),
		'Finding'      => array(
			'Search from the keyboard' => array( array( 'y', 'a command palette, a key for every action' ), array( 'y', 'built-in search and search engines' ), array( 'y', 'Quick Launch: start typing' ), array( 'p', 'a web search box with bangs' ), array( 'y', 'type to filter, number keys for apps' ), array( 'y', 'searches your tiles and the web' ), array( 'y', 'fuzzy search, press /' ) ),
		),
		'Keeping'      => array(
			'Backup of your setup' => array( array( 'y', 'automatic backups, a 30-day trash, HTML and CSV export' ), $u, array( 'p', 'plain config files' ), array( 'p', 'plain config files' ), array( 'y', 'export, backup, optional cloud backup' ), array( 'y', 'import and export' ), array( 'p', 'plain config files' ) ),
		),
		'Watching'     => array(
			'Checks that services are up' => array( array( 'y', '30 days of history on monitored sites, response times, certificates' ), array( 'p', 'reachable or not, per app' ), array( 'y', 'ping and site monitor, with response time' ), array( 'y', 'a monitor widget, with response time' ), array( 'y', 'status and ping checks, with response time' ), $u, array( 'p', 'a Ping card, and cards for Uptime Kuma and Gatus' ) ),
			'Alerts when something goes down' => array( array( 'y', 'ntfy, Pushover, Gotify, Telegram, Slack, Discord, push' ), $u, $u, $u, $u, $u, $u ),
		),
		'Your server'  => array(
			'Docker containers'   => array( array( 'y', 'once you allow it: start, stop, update, roll back, logs' ), array( 'y', 'start, stop, restart, remove, logs' ), array( 'p', 'status and stats' ), array( 'p', 'status' ), $u, $u, array( 'p', 'counts, through a socket proxy card' ) ),
			'Finds your apps by itself' => array( array( 'y', 'from running containers, steered by labels' ), array( 'p', 'add a container from the Docker widget' ), array( 'y', 'from Docker labels' ), array( 'p', 'Docker labels for its widget' ), $u, $u, $u ),
			'Service integrations' => array( '43 widget kinds, and 41 services for the Custom widget', '88 integrations', '100+ integrations', 'about 28 widget types, and a Custom API widget', '73 widgets for services and system stats', '155 apps with live stats', '51 smart cards' ),
			'Looks'               => array( array( 'y', '164 theme families, twelve looks' ), array( 'p', 'background image, custom CSS' ), array( 'y', 'light and dark, 22 colours, custom CSS and JS' ), array( 'y', 'themes, your own colours, custom CSS' ), array( 'y', '40+ themes, a colour editor, custom CSS' ), array( 'p', 'background image, custom CSS' ), array( 'y', 'themes, colours, custom CSS' ) ),
		),
	);
}

/** One paragraph per tool: what it does best, and how nextDash differs. */
function ndw_compare_notes() {
	return array(
		'homarr'   => array( 'A drag-and-drop board you set up without YAML: users and groups, 88 integrations, and Docker control from a widget.', 'nextDash is also a bookmark library, with tags, an inbox and link health, but for one person and without accounts. Homarr is the better fit when several people share a board.' ),
		'homepage' => array( 'A fast start page written as YAML, with 100+ service integrations and services that appear from Docker labels.', 'nextDash is edited in the browser, keeps its bookmarks with tags and checks, and can act on containers, not only show them, once you allow it. Homepage is the better fit if you want everything in files you can version.' ),
		'glance'   => array( 'A light dashboard of feeds: news, Reddit, YouTube, weather and markets, from one small Go binary and a YAML file.', 'nextDash is not a feed reader; it shows what is new but keeps no articles. Its strength is the bookmarks and the server, not the feeds.' ),
		'dashy'    => array( 'A dashboard with a built-in editor or a YAML file, status checks on every item, 73 widgets for services and system stats, 40+ themes, and a login with several users.', 'nextDash adds a bookmark library, container control you switch on, and alerts, for one person without accounts. Dashy has more widgets for general information and more ways to sign in.' ),
		'heimdall' => array( 'A launcher you fill in from the browser: type an app\'s name and its icon and colour appear; 155 apps show live stats; several users are supported.', 'nextDash also checks that services are up, sends alerts and, once you allow it, acts on containers. Heimdall supports several users and has few moving parts.' ),
		'homer'    => array( 'A static page from one YAML file: light, searchable from the keyboard, installable, with 51 smart cards for services.', 'nextDash is edited in the browser and keeps a bookmark library with checks and alerts. Homer asks for less: no database and little to maintain.' ),
	);
}

/** What nextDash is good at, said plainly. */
function ndw_compare_strengths() {
	return array(
		'A bookmark library inside the dashboard: tags, an inbox to sort later, and scheduled link checks.',
		'Alerts when a site or container goes down, to ntfy, Pushover, Gotify, Telegram, Slack, Discord or a push on your phone, with quiet hours and maintenance windows.',
		'Containers you can act on once you allow it: start, stop, update, roll back and read logs from the keyboard, and update a whole stack at once.',
		'Uptime history for 30 days on monitored sites, with response times and certificate checks.',
		'A command palette and a key for every action, and everything is edited in the browser.',
		'Light to run: one container, plain JSON files and about 60 MB of memory when idle.',
		'Automatic backups and a 30-day trash.',
	);
}

/** A cell as HTML. */
function ndw_compare_cell( $cell ) {
	if ( is_string( $cell ) ) {
		return '<span class="nd-cmp-text">' . esc_html( $cell ) . '</span>';
	}
	$labels = array( 'y' => 'Yes', 'p' => 'Partly', 'n' => 'No', 'u' => 'Not documented', 'x' => 'Not what it is for' );
	$mark   = $cell[0];
	$out    = '<span class="nd-cmp-mark nd-cmp-' . esc_attr( $mark ) . '" title="' . esc_attr( $labels[ $mark ] ) . '"><span class="screen-reader-text">' . esc_html( $labels[ $mark ] ) . '</span></span>';
	if ( '' !== $cell[1] ) {
		$out .= '<span class="nd-cmp-note">' . esc_html( $cell[1] ) . '</span>';
	} elseif ( 'u' === $mark ) {
		$out .= '<span class="nd-cmp-note nd-cmp-quiet">not documented</span>';
	}
	return $out;
}

/** Whether the comparison page is published, so links to it may show. */
function ndw_compare_live() {
	$page = get_page_by_path( 'compare' );
	return $page && 'publish' === $page->post_status;
}
