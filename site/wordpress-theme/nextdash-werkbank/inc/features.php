<?php
/**
 * Feature pages: the children of /features/.
 *
 * Carried over from the previous theme with the same meta keys (ndt_feature_*),
 * the same template files and the same [nd_shot] shortcode, so the 23 feature
 * pages need no change. Pictures are looked up in this theme first and in the
 * previous theme's folder after that, until they are all retaken here.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

function ndw_feature_group_labels() {
	return array(
		'basics'   => 'Basics',
		'selfhost' => 'Self-hosting',
		'trust'    => 'Trust',
	);
}

/** URL of a feature picture, relative to assets/img/features/; '' when it is nowhere. */
function ndw_feature_img_url( $rel ) {
	if ( '' === $rel || 0 !== validate_file( $rel ) ) {
		return '';
	}
	$rel   = ltrim( $rel, '/' );
	$roots = array(
		array( get_template_directory(), get_template_directory_uri() ),
		array( get_theme_root() . '/nextdash-terminal', get_theme_root_uri() . '/nextdash-terminal' ),
	);
	foreach ( $roots as $root ) {
		$path = $root[0] . '/assets/img/features/' . $rel;
		if ( file_exists( $path ) ) {
			return esc_url( add_query_arg( 'v', filemtime( $path ), $root[1] . '/assets/img/features/' . $rel ) );
		}
	}
	return '';
}

function ndw_feature_meta_keys() {
	return array(
		'ndt_feature_group'   => 'string',
		'ndt_feature_blurb'   => 'string',
		'ndt_feature_thumb'   => 'string',
		'ndt_feature_keys'    => 'string',
		'ndt_feature_video'   => 'string',
		'ndt_feature_related' => 'string',
		'ndt_feature_since'   => 'string',
		'ndt_feature_order'   => 'integer',
	);
}

function ndw_feature_register_meta() {
	foreach ( ndw_feature_meta_keys() as $key => $type ) {
		register_post_meta(
			'page',
			$key,
			array(
				'type'              => $type,
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'integer' === $type ? 'absint' : 'sanitize_textarea_field',
				'auth_callback'     => function () {
					return current_user_can( 'edit_pages' );
				},
			)
		);
	}
}
add_action( 'init', 'ndw_feature_register_meta' );

/** The fields as a box in the page editor, on the features page and its children. */
function ndw_feature_metabox( $post_type, $post = null ) {
	if ( 'page' !== $post_type || ! $post ) {
		return;
	}
	$parent   = get_page_by_path( 'features' );
	$template = get_page_template_slug( $post );
	$ours     = ( $parent && ( (int) $post->ID === (int) $parent->ID || (int) $post->post_parent === (int) $parent->ID ) )
		|| in_array( $template, array( 'page-feature.php', 'page-features-index.php' ), true );
	if ( $ours ) {
		add_meta_box( 'ndw-feature', 'Feature page', 'ndw_feature_metabox_html', 'page', 'normal', 'default' );
	}
}
add_action( 'add_meta_boxes', 'ndw_feature_metabox', 10, 2 );

function ndw_feature_metabox_html( $post ) {
	wp_nonce_field( 'ndw_feature_save', 'ndw_feature_nonce' );
	foreach ( ndw_feature_meta_keys() as $key => $type ) {
		printf(
			'<p><label><strong>%1$s</strong><br><textarea name="%1$s" rows="%3$d" style="width:100%%">%2$s</textarea></label></p>',
			esc_attr( $key ),
			esc_textarea( (string) get_post_meta( $post->ID, $key, true ) ),
			'ndt_feature_keys' === $key ? 5 : 1
		);
	}
}

function ndw_feature_save( $post_id ) {
	if ( ! isset( $_POST['ndw_feature_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['ndw_feature_nonce'] ) ), 'ndw_feature_save' ) ) {
		return;
	}
	if ( ! current_user_can( 'edit_page', $post_id ) ) {
		return;
	}
	foreach ( array_keys( ndw_feature_meta_keys() ) as $key ) {
		if ( ! isset( $_POST[ $key ] ) ) {
			continue;
		}
		$value = 'ndt_feature_order' === $key ? absint( $_POST[ $key ] ) : sanitize_textarea_field( wp_unslash( $_POST[ $key ] ) );
		if ( '' === $value ) {
			delete_post_meta( $post_id, $key );
		} else {
			update_post_meta( $post_id, $key, $value );
		}
	}
}
add_action( 'save_post_page', 'ndw_feature_save' );

/**
 * "Shift+Y | Open Containers" per line into key chips and a label.
 * A literal plus key is written as "Ctrl++", or "+" on its own.
 */
function ndw_feature_parse_keys( $raw ) {
	$out = array();
	foreach ( preg_split( '/\r\n|\r|\n/', (string) $raw ) as $line ) {
		$line = trim( $line );
		if ( '' === $line ) {
			continue;
		}
		$parts = array_map( 'trim', explode( '|', $line, 2 ) );
		$combo = $parts[0];
		$label = isset( $parts[1] ) ? $parts[1] : '';
		if ( '' === $combo ) {
			continue;
		}
		if ( '+' === $combo ) {
			$keys = array( '+' );
		} elseif ( '+' === substr( $combo, -1 ) && strlen( $combo ) > 1 ) {
			$head = rtrim( substr( $combo, 0, -1 ), '+' );
			$keys = '' === $head ? array( '+' ) : array_merge( explode( '+', $head ), array( '+' ) );
		} else {
			$keys = explode( '+', $combo );
		}
		$keys = array_values( array_filter( array_map( 'trim', $keys ), 'strlen' ) );
		if ( $keys ) {
			$out[] = array( 'keys' => $keys, 'label' => $label );
		}
	}
	return $out;
}

/** Children of /features/, published (and drafts for editors), with their fields. */
function ndw_feature_pages() {
	static $cache = array();
	$editor = current_user_can( 'edit_pages' );
	if ( isset( $cache[ (int) $editor ] ) ) {
		return $cache[ (int) $editor ];
	}
	$parent = get_page_by_path( 'features' );
	if ( ! $parent ) {
		return array();
	}
	$posts = get_posts(
		array(
			'post_type'      => 'page',
			'post_parent'    => $parent->ID,
			'post_status'    => $editor ? array( 'publish', 'draft' ) : array( 'publish' ),
			'posts_per_page' => 100,
			'no_found_rows'  => true,
		)
	);
	$out = array();
	foreach ( $posts as $p ) {
		$thumb = (string) get_post_meta( $p->ID, 'ndt_feature_thumb', true );
		$out[] = array(
			'id'     => $p->ID,
			'slug'   => $p->post_name,
			'title'  => get_the_title( $p ),
			'url'    => get_permalink( $p ),
			'blurb'  => (string) get_post_meta( $p->ID, 'ndt_feature_blurb', true ),
			'thumb'  => $thumb ? ndw_feature_img_url( $thumb ) : '',
			'video'  => (string) get_post_meta( $p->ID, 'ndt_feature_video', true ),
			'group'  => (string) get_post_meta( $p->ID, 'ndt_feature_group', true ),
			'order'  => (int) get_post_meta( $p->ID, 'ndt_feature_order', true ),
			'status' => $p->post_status,
		);
	}
	$cache[ (int) $editor ] = $out;
	return $out;
}

/** The pages per group, in the group order above, each group by its order field. */
function ndw_feature_groups() {
	$groups = array();
	foreach ( array_keys( ndw_feature_group_labels() ) as $slug ) {
		$pages = array_values(
			array_filter(
				ndw_feature_pages(),
				function ( $p ) use ( $slug ) {
					return $p['group'] === $slug;
				}
			)
		);
		usort(
			$pages,
			function ( $a, $b ) {
				return $a['order'] <=> $b['order'] ?: strcasecmp( $a['title'], $b['title'] );
			}
		);
		if ( $pages ) {
			$groups[ $slug ] = $pages;
		}
	}
	return $groups;
}

/** [nd_shot src="keys/shot-1.jpg" alt="" caption=""]: a screenshot that opens larger. */
function ndw_feature_shot_shortcode( $atts ) {
	$a   = shortcode_atts( array( 'src' => '', 'alt' => '', 'caption' => '' ), $atts );
	$src = '' === $a['src'] ? '' : ndw_feature_img_url( $a['src'] );
	if ( '' === $src ) {
		return '';
	}
	$img = sprintf( '<img src="%s" alt="%s" loading="lazy" decoding="async">', $src, esc_attr( $a['alt'] ) );
	$cap = $a['caption'] ? '<figcaption>' . esc_html( $a['caption'] ) . '</figcaption>' : '';
	return '<figure class="nd-fig">' . $img . $cap . '</figure>';
}
add_shortcode( 'nd_shot', 'ndw_feature_shot_shortcode' );

/** Picture and description for sharing a feature page (see inc/seo.php). */
function ndw_feature_share() {
	if ( ! is_page_template( 'page-feature.php' ) ) {
		return false;
	}
	$id    = get_queried_object_id();
	$thumb = (string) get_post_meta( $id, 'ndt_feature_thumb', true );
	return array(
		'image'       => $thumb ? ndw_feature_img_url( $thumb ) : '',
		'description' => (string) get_post_meta( $id, 'ndt_feature_blurb', true ),
	);
}

/**
 * The docs chapter that explains a feature, by the feature page's slug.
 * Feature pages end with a link to it.
 */
function ndw_feature_docs_url( $slug ) {
	$chapters = apply_filters(
		'ndw_feature_docs_chapters',
		array(
			'install'        => 'installation',
			'keys'           => 'keyboard',
			'find'           => 'search-commands-and-finders',
			'looks'          => 'appearance',
			'themes'         => 'appearance',
			'capture'        => 'browser-extension-and-capture',
			'collections'    => 'pages-categories-and-collections',
			'widgets'        => 'widgets',
			'custom-widgets' => 'widgets',
			'media-widgets'  => 'widgets',
			'tags'           => 'tags',
			'appearance'     => 'appearance',
			'inbox'          => 'inbox',
			'move-blocks'    => 'the-dashboard',
			'page-templates' => 'pages-categories-and-collections',
			'extras'         => 'the-dashboard',
			'status-page'    => 'checks-and-health',
			'containers'     => 'containers',
			'unraid'         => 'widgets',
			'health'         => 'checks-and-health',
			'alerts'         => 'checks-and-health',
			'copies'         => 'data-backups-and-import',
			'data'           => 'data-backups-and-import',
			'statistics'     => 'statistics',
			'config'         => 'config',
			'app-icons'      => 'appearance',
			'trust'          => 'security-and-self-hosting',
		)
	);
	return isset( $chapters[ $slug ] ) ? home_url( '/docs/' . $chapters[ $slug ] . '.html' ) : home_url( '/docs/' );
}
