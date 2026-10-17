<?php
/**
 * nextDash Werkbank: the quiet theme for nextdash.cc.
 *
 * The page templates keep the file names of the previous theme
 * (page-feature.php, page-features-index.php), so pages that use them work
 * the moment this theme is switched on, and switching back needs no change
 * in the database. The feature fields keep their ndt_ meta keys for the same
 * reason.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

define( 'NDW_VERSION', '1.0.0' );

require_once get_template_directory() . '/inc/helpers.php';
require_once get_template_directory() . '/inc/features.php';
require_once get_template_directory() . '/inc/seo.php';
require_once get_template_directory() . '/inc/gallery.php';
require_once get_template_directory() . '/inc/motion.php';
require_once get_template_directory() . '/inc/compare.php';

function ndw_setup() {
	add_theme_support( 'automatic-feed-links' );
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'align-wide' );
	add_theme_support( 'html5', array( 'search-form', 'comment-form', 'comment-list', 'gallery', 'caption', 'style', 'script' ) );
	add_theme_support( 'editor-styles' );
	add_editor_style( 'assets/css/werkbank.css' );
}
add_action( 'after_setup_theme', 'ndw_setup' );

function ndw_assets() {
	wp_enqueue_style( 'ndw-fonts', 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Code+Pro:wght@400;500&display=swap', array(), null );
	wp_enqueue_style( 'ndw', get_template_directory_uri() . '/assets/css/werkbank.css', array(), ndw_asset_version( 'assets/css/werkbank.css' ) );
	wp_enqueue_script( 'ndw', get_template_directory_uri() . '/assets/js/site.js', array(), ndw_asset_version( 'assets/js/site.js' ), array( 'strategy' => 'defer', 'in_footer' => true ) );
	wp_localize_script(
		'ndw',
		'ndwSite',
		array(
			'docs'    => home_url( '/docs/' ),
			'search'  => rest_url( 'wp/v2/search' ),
			'results' => home_url( '/?s=' ),
			// Theme names, so the search can point at the gallery.
			'themes'  => ndw_gallery_theme_names(),
			'gallery' => home_url( '/themes/' ),
		)
	);
	// The moving parts of the homepage and Features.
	if ( is_front_page() || is_page( 'features' ) ) {
		wp_enqueue_script( 'ndw-motion', get_template_directory_uri() . '/assets/js/motion.js', array(), ndw_asset_version( 'assets/js/motion.js' ), array( 'strategy' => 'defer', 'in_footer' => true ) );
	}
	// The theme gallery and the homepage slider, where they are drawn.
	if ( ndw_gallery_data() && is_page( 'themes' ) ) {
		wp_enqueue_script( 'ndw-gallery', get_template_directory_uri() . '/assets/js/gallery.js', array(), ndw_asset_version( 'assets/js/gallery.js' ), array( 'strategy' => 'defer', 'in_footer' => true ) );
	}
}
add_action( 'wp_enqueue_scripts', 'ndw_assets' );

/** Light or dark before the first paint: the choice made here or in the docs (one key for both), else the system. */
function ndw_theme_boot() {
	// nd-motion: sections may fade in, unless the reader asked for less motion.
	echo "<script>try{localStorage.removeItem('nd-theme');var t=localStorage.getItem('vitepress-theme-appearance');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))document.documentElement.classList.add('nd-motion')</script>\n";
}
add_action( 'wp_head', 'ndw_theme_boot', 1 );

function ndw_preconnect( $urls, $relation ) {
	if ( 'preconnect' === $relation ) {
		$urls[] = 'https://fonts.googleapis.com';
		$urls[] = array( 'href' => 'https://fonts.gstatic.com', 'crossorigin' );
	}
	return $urls;
}
add_filter( 'wp_resource_hints', 'ndw_preconnect', 10, 2 );

function ndw_favicon() {
	$icon = get_template_directory_uri() . '/assets/img/favicon.svg';
	printf( '<link rel="icon" href="%s" type="image/svg+xml">' . "\n", esc_url( $icon ) );
}
add_action( 'wp_head', 'ndw_favicon', 5 );

function ndw_excerpt_more() {
	return '…';
}
add_filter( 'excerpt_more', 'ndw_excerpt_more' );

function ndw_excerpt_length() {
	return 32;
}
add_filter( 'excerpt_length', 'ndw_excerpt_length' );

/* Comments are closed everywhere; a link under each post points to GitHub Discussions. */
add_filter( 'comments_open', '__return_false', 20 );
add_filter( 'pings_open', '__return_false', 20 );

function ndw_archive_title( $title ) {
	if ( is_category() ) {
		return single_cat_title( '', false );
	}
	if ( is_tag() ) {
		return '#' . single_tag_title( '', false );
	}
	return $title;
}
add_filter( 'get_the_archive_title', 'ndw_archive_title' );
