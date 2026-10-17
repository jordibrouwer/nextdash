<?php
/**
 * Small helpers shared by the templates.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

/** Cache-busting version for a theme file: its modification time. */
function ndw_asset_version( $relative_path ) {
	$file = get_template_directory() . '/' . ltrim( $relative_path, '/' );
	return file_exists( $file ) ? (string) filemtime( $file ) : NDW_VERSION;
}

/** The repository, the demo and the discussions, in one place. */
function ndw_links() {
	return apply_filters(
		'ndw_links',
		array(
			'github'      => 'https://github.com/jordibrouwer/nextdash',
			'discussions' => 'https://github.com/jordibrouwer/nextdash/discussions',
			'changelog'   => 'https://github.com/jordibrouwer/nextdash/blob/main/CHANGELOG.md',
			'license'     => 'https://github.com/jordibrouwer/nextdash/blob/main/LICENSE',
			'demo'        => 'https://demo.nextdash.cc',
			'unraid'      => 'https://github.com/jordibrouwer/unraid_templates',
		)
	);
}

/**
 * The main menu, the same on the site and in the docs (site/.vitepress/config.mts).
 * Each item: label, url, and whether it leaves the site.
 */
function ndw_nav_items() {
	$links = ndw_links();
	return apply_filters(
		'ndw_nav_items',
		array(
			array( 'label' => 'Features', 'url' => home_url( '/features/' ) ),
			array( 'label' => 'Themes', 'url' => home_url( '/themes/' ) ),
			array( 'label' => 'Install', 'url' => home_url( '/docs/installation.html' ) ),
			array( 'label' => 'Docs', 'url' => home_url( '/docs/' ) ),
			array( 'label' => 'Integrations', 'url' => home_url( '/docs/widgets.html' ) ),
			array( 'label' => 'News', 'url' => home_url( '/news/' ) ),
			array( 'label' => 'Demo', 'url' => $links['demo'], 'external' => true ),
		)
	);
}

/** True when the menu item is the section the reader is in. */
function ndw_nav_is_current( $url ) {
	$path    = untrailingslashit( (string) wp_parse_url( $url, PHP_URL_PATH ) );
	$current = untrailingslashit( (string) wp_parse_url( home_url( add_query_arg( null, null ) ), PHP_URL_PATH ) );
	if ( '' === $path ) {
		return false;
	}
	// /themes/ leads to the Theme studio page; there Themes is the section, not Features.
	if ( '/themes' === $path ) {
		return is_page( 'themes' );
	}
	if ( '/features' === $path && is_page( 'themes' ) ) {
		return false;
	}
	if ( '/news' === $path ) {
		return is_home() || is_singular( 'post' ) || is_category() || is_tag() || is_date() || is_author();
	}
	return $current === $path || 0 === strpos( $current . '/', $path . '/' );
}

/**
 * The newest release on GitHub: version, date and link, kept for twelve hours.
 * The last answer is kept as well, so a failed request shows that one.
 */
function ndw_latest_release() {
	$cached = get_transient( 'ndw_latest_release' );
	if ( false !== $cached ) {
		return $cached ? $cached : false;
	}

	$response = wp_remote_get(
		'https://api.github.com/repos/jordibrouwer/nextdash/releases/latest',
		array(
			'timeout' => 5,
			'headers' => array(
				'Accept'     => 'application/vnd.github+json',
				'User-Agent' => 'nextdash-werkbank-wp-theme',
			),
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		$stale = get_option( 'ndw_latest_release_stale' );
		set_transient( 'ndw_latest_release', $stale ? $stale : array(), 15 * MINUTE_IN_SECONDS );
		return $stale ? $stale : false;
	}

	$body = json_decode( wp_remote_retrieve_body( $response ), true );
	if ( empty( $body['tag_name'] ) ) {
		set_transient( 'ndw_latest_release', array(), HOUR_IN_SECONDS );
		return false;
	}

	$data = array(
		'version' => sanitize_text_field( $body['tag_name'] ),
		'date'    => isset( $body['published_at'] ) ? sanitize_text_field( $body['published_at'] ) : '',
		'url'     => isset( $body['html_url'] ) ? esc_url_raw( $body['html_url'] ) : ndw_links()['github'],
	);
	set_transient( 'ndw_latest_release', $data, 12 * HOUR_IN_SECONDS );
	update_option( 'ndw_latest_release_stale', $data, false );
	return $data;
}

/**
 * The post that announces a release: one whose title names the version, else
 * the newest post in Releases (a post may cover several patch releases).
 */
function ndw_release_post( $version ) {
	$recent = get_posts(
		array(
			'post_type'      => 'post',
			'posts_per_page' => 10,
			'category_name'  => 'releases',
			'no_found_rows'  => true,
		)
	);
	foreach ( $recent as $p ) {
		if ( $version && false !== stripos( get_the_title( $p ), $version ) ) {
			return $p;
		}
	}
	return $recent ? $recent[0] : null;
}

/** "3 min read", from the words in a post. */
function ndw_reading_time( $post = null ) {
	$words = str_word_count( wp_strip_all_tags( get_post_field( 'post_content', $post ) ) );
	return sprintf( '%d min read', max( 1, (int) round( $words / 220 ) ) );
}

/** The small ASCII mark in the footer. */
function ndw_ascii_mark() {
	return "┌┐┌┌─┐─┐ ┬┌┬┐┌┬┐┌─┐┌─┐┬ ┬\n│││├┤ ┌┴┬┘ │  ││├─┤└─┐├─┤\n┘└┘└─┘┴ └─ ┴ ─┴┘┴ ┴└─┘┴ ┴";
}

/** An inline icon from a fixed set, for the header buttons. */
function ndw_icon( $name ) {
	$icons = array(
		'github' => '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
		'theme'  => '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2v14a7 7 0 0 1 0-14z"/></svg>',
		'search' => '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15zM16 16l5 5"/></svg>',
	);
	return isset( $icons[ $name ] ) ? $icons[ $name ] : '';
}
