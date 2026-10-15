<?php
/**
 * What search engines and link previews read, carried over from the previous
 * theme: meta description, Open Graph and Twitter cards, and JSON-LD for the
 * front page, posts and their breadcrumbs. Nothing here runs when an SEO
 * plugin does the same.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

function ndw_has_seo_plugin() {
	return defined( 'WPSEO_VERSION' ) || class_exists( 'RankMath' ) || defined( 'AIOSEO_VERSION' );
}

/** The description of the page being shown: a post's excerpt, a feature's blurb, or the tagline. */
function ndw_page_description() {
	$description = is_singular( 'post' ) ? wp_strip_all_tags( get_the_excerpt() ) : '';
	$feature     = ndw_feature_share();
	if ( $feature && $feature['description'] ) {
		$description = $feature['description'];
	}
	if ( ! $description && is_front_page() ) {
		$description = ndw_tagline();
	}
	return $description ? $description : get_bloginfo( 'description', 'display' );
}

/** The one sentence that says what nextDash is. */
function ndw_tagline() {
	return apply_filters( 'ndw_tagline', 'A self-hosted bookmark dashboard that checks your links and knows your Docker host.' );
}

function ndw_meta_description() {
	if ( ndw_has_seo_plugin() ) {
		return;
	}
	$description = ndw_page_description();
	if ( $description ) {
		printf( '<meta name="description" content="%s">' . "\n", esc_attr( $description ) );
	}
}
add_action( 'wp_head', 'ndw_meta_description', 3 );

/** A missing page is not worth indexing; core does the same for search results. */
function ndw_404_robots( $robots ) {
	if ( is_404() ) {
		$robots['noindex'] = true;
	}
	return $robots;
}
add_filter( 'wp_robots', 'ndw_404_robots' );

function ndw_social_meta() {
	if ( ndw_has_seo_plugin() ) {
		return;
	}
	$is_post = is_singular( 'post' );
	$image   = '';
	$width   = 1200;
	$height  = 630;
	if ( is_singular() && has_post_thumbnail() ) {
		$thumb = wp_get_attachment_image_src( get_post_thumbnail_id(), 'large' );
		if ( $thumb ) {
			list( $image, $width, $height ) = $thumb;
		}
	}
	$feature = ndw_feature_share();
	if ( $feature && $feature['image'] ) {
		$image  = $feature['image'];
		$width  = 1440;
		$height = 900;
	}
	if ( ! $image ) {
		$image = get_template_directory_uri() . '/assets/img/og-1200x630.png';
	}
	$tags = array(
		'og:type'        => $is_post ? 'article' : 'website',
		'og:title'       => wp_get_document_title(),
		'og:description' => ndw_page_description(),
		'og:url'         => home_url( add_query_arg( null, null ) ),
		'og:site_name'   => get_bloginfo( 'name' ),
		'og:image'       => $image,
		'og:image:width' => (string) (int) $width,
		'og:image:height' => (string) (int) $height,
	);
	foreach ( $tags as $property => $content ) {
		printf( '<meta property="%s" content="%s">' . "\n", esc_attr( $property ), esc_attr( $content ) );
	}
	printf( '<meta name="twitter:card" content="summary_large_image">' . "\n" );
	printf( '<meta name="twitter:title" content="%s">' . "\n", esc_attr( $tags['og:title'] ) );
	printf( '<meta name="twitter:description" content="%s">' . "\n", esc_attr( $tags['og:description'] ) );
	printf( '<meta name="twitter:image" content="%s">' . "\n", esc_url( $image ) );
}
add_action( 'wp_head', 'ndw_social_meta', 4 );

function ndw_json_ld( $schema ) {
	echo '<script type="application/ld+json">' . wp_json_encode( $schema ) . '</script>' . "\n";
}

function ndw_schema() {
	if ( ndw_has_seo_plugin() ) {
		return;
	}
	if ( is_front_page() ) {
		ndw_json_ld(
			array(
				'@context'        => 'https://schema.org',
				'@type'           => 'WebSite',
				'name'            => get_bloginfo( 'name' ),
				'url'             => home_url( '/' ),
				'potentialAction' => array(
					'@type'       => 'SearchAction',
					'target'      => array( '@type' => 'EntryPoint', 'urlTemplate' => home_url( '/?s={search_term_string}' ) ),
					'query-input' => 'required name=search_term_string',
				),
			)
		);
		ndw_json_ld(
			array(
				'@context'            => 'https://schema.org',
				'@type'               => 'SoftwareApplication',
				'name'                => 'nextDash',
				'applicationCategory' => 'UtilitiesApplication',
				'operatingSystem'     => 'Docker, Linux, macOS, Windows',
				'description'         => ndw_tagline(),
				'url'                 => home_url( '/' ),
				'license'             => ndw_links()['license'],
				'offers'              => array( '@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'EUR' ),
			)
		);
	}
	if ( ! is_singular( 'post' ) ) {
		return;
	}
	$items = array( array( '@type' => 'ListItem', 'position' => 1, 'name' => get_bloginfo( 'name' ), 'item' => home_url( '/' ) ) );
	$cats  = get_the_category();
	if ( $cats ) {
		$items[] = array( '@type' => 'ListItem', 'position' => 2, 'name' => $cats[0]->name, 'item' => get_category_link( $cats[0] ) );
	}
	$items[] = array( '@type' => 'ListItem', 'position' => count( $items ) + 1, 'name' => get_the_title(), 'item' => get_permalink() );
	ndw_json_ld( array( '@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $items ) );

	$article = array(
		'@context'         => 'https://schema.org',
		'@type'            => 'Article',
		'headline'         => get_the_title(),
		'datePublished'    => get_the_date( DATE_W3C ),
		'dateModified'     => get_the_modified_date( DATE_W3C ),
		'description'      => wp_strip_all_tags( get_the_excerpt() ),
		'author'           => array( '@type' => 'Person', 'name' => get_the_author() ),
		'publisher'        => array( '@type' => 'Organization', 'name' => get_bloginfo( 'name' ) ),
		'mainEntityOfPage' => array( '@type' => 'WebPage', '@id' => get_permalink() ),
	);
	if ( has_post_thumbnail() ) {
		$thumb = wp_get_attachment_image_src( get_post_thumbnail_id(), 'large' );
		if ( $thumb ) {
			$article['image'] = $thumb[0];
		}
	}
	ndw_json_ld( $article );
}
add_action( 'wp_head', 'ndw_schema' );
