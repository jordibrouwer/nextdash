<?php
/**
 * The theme gallery on the Theme studio page and the slider on the homepage.
 *
 * Both read assets/img/features/themes/gallery/gallery.json, which
 * scripts/feature-shots/capture-themes.js writes next to the pictures. Without
 * that file neither shows.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

/** The gallery's manifest, or null when the pictures are not there. */
function ndw_gallery_data() {
	static $data = false;
	if ( false !== $data ) {
		return $data;
	}
	$file = get_template_directory() . '/assets/img/features/themes/gallery/gallery.json';
	$data = is_readable( $file ) ? json_decode( (string) file_get_contents( $file ), true ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions
	if ( ! is_array( $data ) || empty( $data['shots'] ) ) {
		$data = null;
	}
	return $data;
}

/** URL of a gallery picture by shot id; $thumb for the small one. */
function ndw_gallery_img( $id, $thumb = false ) {
	$rel = 'assets/img/features/themes/gallery/' . $id . ( $thumb ? '-thumb' : '' ) . '.webp';
	return get_template_directory_uri() . '/' . $rel . '?v=' . ndw_asset_version( $rel );
}

/** A word for display: 'night-sky' becomes 'Night sky'. */
function ndw_gallery_word( $slug ) {
	return ucfirst( str_replace( '-', ' ', (string) $slug ) );
}

/** The look's label from the manifest, by id. */
function ndw_gallery_look_label( $id ) {
	$data = ndw_gallery_data();
	foreach ( (array) ( $data['looks'] ?? array() ) as $l ) {
		if ( $l['id'] === $id ) {
			return $l['label'];
		}
	}
	return ndw_gallery_word( $id );
}

/** What a shot shows besides its theme, for the caption: 'look Glass', 'backdrop Stars'. */
function ndw_gallery_detail( $s ) {
	$parts = array( $s['mode'], ndw_gallery_word( $s['group'] ) );
	if ( 'look' === $s['kind'] ) {
		$parts[] = 'look ' . ndw_gallery_look_label( $s['look'] );
	} elseif ( 'surface' === $s['kind'] ) {
		$parts[] = 'surface ' . ndw_gallery_word( $s['surface'] );
	} elseif ( 'backdrop' === $s['kind'] ) {
		$parts[] = 'backdrop ' . ndw_gallery_word( $s['backdrop'] );
	}
	return implode( ' · ', $parts );
}

/** One row of filter buttons. $values maps value => label; the first is pressed. */
function ndw_gallery_row( $label, $filter, $values, $row = '' ) {
	$out   = '<div class="nd-gal-row"' . ( $row ? ' data-gal-row="' . esc_attr( $row ) . '"' : '' ) . ' role="group" aria-label="' . esc_attr( $label ) . '">';
	$out  .= '<span class="nd-gal-label">' . esc_html( $label ) . '</span>';
	$first = true;
	foreach ( $values as $value => $text ) {
		$out  .= sprintf(
			'<button type="button" class="nd-chip" data-gal-filter="%s" data-gal-value="%s" aria-pressed="%s">%s</button>',
			esc_attr( $filter ),
			esc_attr( $value ),
			$first ? 'true' : 'false',
			esc_html( $text )
		);
		$first = false;
	}
	return $out . '</div>';
}

/** The gallery with its filters; '' without pictures. */
function ndw_theme_gallery() {
	$data = ndw_gallery_data();
	if ( ! $data ) {
		return '';
	}
	$shots  = $data['shots'];
	$groups = array( 'all' => 'All' );
	foreach ( $data['groups'] as $g ) {
		foreach ( $shots as $s ) {
			if ( 'theme' === $s['kind'] && $s['group'] === $g ) {
				$groups[ $g ] = ndw_gallery_word( $g );
				break;
			}
		}
	}
	$looks = array( 'all' => 'All' );
	foreach ( $data['looks'] as $l ) {
		$looks[ $l['id'] ] = $l['label'];
	}
	$depths = array( 'all' => 'All' );
	foreach ( $data['depths'] as $d ) {
		$depths[ $d ] = ndw_gallery_word( $d );
	}
	$backdrops = array( 'all' => 'All' );
	foreach ( $data['backdrops'] as $b ) {
		$backdrops[ $b ] = ndw_gallery_word( $b );
	}

	ob_start();
	?>
	<section class="nd-wrap nd-gallery" data-nd-gallery aria-labelledby="nd-gal-h">
		<h2 id="nd-gal-h">See it in other clothes</h2>
		<p class="nd-muted">The same dashboard, real servers and all, in a selection of the themes, in each of the twelve looks, in the five surfaces and on every backdrop. Click a picture to see it large; the arrow keys page through what the filters show.</p>
		<div class="nd-gal-filters">
			<div class="nd-gal-row">
				<label class="nd-gal-label" for="nd-gal-q">Find</label>
				<input id="nd-gal-q" class="nd-gal-search" type="search" placeholder="A theme, look or backdrop: Slate, neon, frosted…" autocomplete="off" spellcheck="false" data-gal-search>
			</div>
			<?php
			echo ndw_gallery_row( 'Show', 'kind', array( 'theme' => 'Themes', 'look' => 'Looks', 'surface' => 'Surfaces', 'backdrop' => 'Backdrops' ) ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_gallery_row( 'Mode', 'mode', array( 'all' => 'All', 'dark' => 'Dark', 'light' => 'Light' ) ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_gallery_row( 'Material', 'group', $groups, 'theme' ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_gallery_row( 'Look', 'look', $looks, 'look' ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_gallery_row( 'Surface', 'surface', $depths, 'surface' ); // phpcs:ignore WordPress.Security.EscapeOutput
			echo ndw_gallery_row( 'Backdrop', 'backdrop', $backdrops, 'backdrop' ); // phpcs:ignore WordPress.Security.EscapeOutput
			?>
		</div>
		<p class="nd-gal-count nd-muted" aria-live="polite" data-gal-count></p>
		<ul class="nd-gal-grid">
			<?php foreach ( $shots as $s ) : ?>
				<?php $detail = ndw_gallery_detail( $s ); ?>
				<li data-find="<?php echo esc_attr( strtolower( $s['name'] . ' ' . $detail . ' ' . $s['description'] ) ); ?>" data-kind="<?php echo esc_attr( $s['kind'] ); ?>" data-mode="<?php echo esc_attr( $s['mode'] ); ?>" data-group="<?php echo esc_attr( $s['group'] ); ?>" data-look="<?php echo esc_attr( $s['look'] ); ?>" data-surface="<?php echo esc_attr( $s['surface'] ); ?>" data-backdrop="<?php echo esc_attr( $s['backdrop'] ); ?>">
					<button type="button" class="nd-gal-item" data-full="<?php echo esc_url( ndw_gallery_img( $s['id'] ) ); ?>" data-cap="<?php echo esc_attr( $s['name'] . ' · ' . $detail ); ?>">
						<img src="<?php echo esc_url( ndw_gallery_img( $s['id'], true ) ); ?>" width="560" height="350" loading="lazy" decoding="async" alt="<?php echo esc_attr( sprintf( 'The dashboard in %s, %s', $s['name'], $detail ) ); ?>">
						<span class="nd-gal-cap"><b><?php echo esc_html( $s['name'] ); ?></b><small><?php echo esc_html( $detail ); ?></small></span>
					</button>
				</li>
			<?php endforeach; ?>
		</ul>
	</section>
	<?php
	return (string) ob_get_clean();
}

/**
 * The shots on the homepage slider, by id, in order: a spread of materials,
 * dark and light, and looks with glass and backdrops.
 */
function ndw_home_slide_ids() {
	return apply_filters(
		'ndw_home_slides',
		array(
			'theme-slate-dark',
			'look-glass-synth-sunset-dark',
			'theme-absinthe-light',
			'look-aurora-gloss-liquid-chrome-dark',
			'look-frosted-slate-light',
			'look-night-sky-synth-sunset-dark',
			'look-desert-paper-ink-light',
			'look-neon-gloss-liquid-chrome-dark',
			'look-glass-boxed-slate-light',
			'look-blueprint-paper-ink-light',
			'look-terminal-synth-sunset-dark',
			'backdrop-mountains',
			'look-soft-slate-light',
		)
	);
}

/** The homepage slider; '' without pictures. */
function ndw_home_slider() {
	$data = ndw_gallery_data();
	if ( ! $data ) {
		return '';
	}
	$by_id = array();
	foreach ( $data['shots'] as $s ) {
		$by_id[ $s['id'] ] = $s;
	}
	$slides = array_values( array_filter( array_map( function ( $id ) use ( $by_id ) {
		return $by_id[ $id ] ?? null;
	}, ndw_home_slide_ids() ) ) );
	if ( ! $slides ) {
		return '';
	}
	$themes = get_page_by_path( 'features/themes' );
	ob_start();
	?>
	<section class="nd-sec">
		<div class="nd-wrap nd-slider-wrap">
			<div class="nd-slider-text">
				<p class="nd-label">Theme studio</p>
				<h2>One dashboard, many ways to dress it.</h2>
				<p>164 theme families in dark and light, twelve looks, five surfaces and 26 backdrops, with glass, blur and depth to taste. All built in.</p>
				<?php if ( $themes ) : ?>
					<p><a href="<?php echo esc_url( get_permalink( $themes ) . '#nd-gal-h' ); ?>">Browse the gallery →</a></p>
				<?php endif; ?>
			</div>
			<div class="nd-slider" data-nd-slider aria-roledescription="carousel" aria-label="nextDash in different themes and looks">
				<div class="nd-slider-track">
					<?php foreach ( $slides as $i => $s ) : ?>
						<figure class="nd-slide<?php echo 0 === $i ? ' is-on' : ''; ?>" aria-roledescription="slide" aria-label="<?php echo esc_attr( sprintf( '%d of %d', $i + 1, count( $slides ) ) ); ?>"<?php echo 0 === $i ? '' : ' aria-hidden="true"'; ?>>
							<img src="<?php echo esc_url( ndw_gallery_img( $s['id'] ) ); ?>" width="1680" height="1050" <?php echo 0 === $i ? '' : 'loading="lazy"'; ?> decoding="async" alt="<?php echo esc_attr( sprintf( 'The nextDash dashboard in %s, %s', $s['name'], ndw_gallery_detail( $s ) ) ); ?>">
							<figcaption><b><?php echo esc_html( $s['name'] ); ?></b> · <?php echo esc_html( ndw_gallery_detail( $s ) ); ?></figcaption>
						</figure>
					<?php endforeach; ?>
				</div>
				<div class="nd-slider-bar">
					<button type="button" class="nd-icon-btn" data-slide-prev aria-label="Previous">‹</button>
					<span class="nd-slider-dots">
						<?php foreach ( $slides as $i => $s ) : ?>
							<button type="button" class="nd-slider-dot" data-slide-to="<?php echo (int) $i; ?>" aria-label="<?php echo esc_attr( sprintf( 'Show %s', $s['name'] ) ); ?>"<?php echo 0 === $i ? ' aria-current="true"' : ''; ?>></button>
						<?php endforeach; ?>
					</span>
					<button type="button" class="nd-icon-btn" data-slide-next aria-label="Next">›</button>
					<button type="button" class="nd-slider-pause" data-slide-pause>Pause</button>
				</div>
			</div>
		</div>
	</section>
	<?php
	return (string) ob_get_clean();
}

/** The Theme studio page, where the gallery lives; null when it does not exist. */
function ndw_gallery_page() {
	$page = get_page_by_path( 'features/themes' );
	return ( $page && 'publish' === $page->post_status ) ? $page : null;
}

/**
 * nextdash.cc/themes/ is the gallery's own short address: it goes to the
 * Theme studio page, with what was asked (?find=slate) kept.
 */
function ndw_gallery_short_url() {
	$path = trim( (string) wp_parse_url( isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '', PHP_URL_PATH ), '/' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
	if ( 'themes' !== $path ) {
		return;
	}
	$page = ndw_gallery_page();
	if ( ! $page ) {
		return;
	}
	$target = get_permalink( $page );
	foreach ( array( 'find', 'show' ) as $key ) {
		$value = isset( $_GET[ $key ] ) ? sanitize_text_field( wp_unslash( $_GET[ $key ] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
		if ( '' !== $value ) {
			$target = add_query_arg( $key, rawurlencode( $value ), $target );
		}
	}
	wp_safe_redirect( $target, 302 );
	exit;
}
add_action( 'template_redirect', 'ndw_gallery_short_url', 1 );

/** Six dashboards and a jump to the gallery, at the top of the Theme studio page. */
function ndw_gallery_teaser() {
	$data = ndw_gallery_data();
	if ( ! $data ) {
		return '';
	}
	$by_id = array();
	foreach ( $data['shots'] as $s ) {
		$by_id[ $s['id'] ] = $s;
	}
	$pick = array_values( array_filter( array_map( function ( $id ) use ( $by_id ) {
		return $by_id[ $id ] ?? null;
	}, array_slice( ndw_home_slide_ids(), 0, 6 ) ) ) );
	ob_start();
	?>
	<aside class="nd-gal-teaser" aria-label="Theme gallery">
		<ul>
			<?php foreach ( $pick as $s ) : ?>
				<li><a href="#nd-gal-h"><img src="<?php echo esc_url( ndw_gallery_img( $s['id'], true ) ); ?>" width="560" height="350" alt="<?php echo esc_attr( sprintf( 'The dashboard in %s', $s['name'] ) ); ?>"></a></li>
			<?php endforeach; ?>
		</ul>
		<p><a class="nd-btn nd-btn--primary" href="#nd-gal-h"><?php echo esc_html( sprintf( 'Browse %d dashboards ↓', count( $data['shots'] ) ) ); ?></a> <span class="nd-muted">Every material, the twelve looks, the surfaces and the backdrops, with a search.</span></p>
	</aside>
	<?php
	return (string) ob_get_clean();
}

/** A card for the gallery on the Features overview; '' without it. */
function ndw_gallery_card() {
	$data = ndw_gallery_data();
	if ( ! $data ) {
		return '';
	}
	$first = ndw_home_slide_ids()[0] ?? '';
	ob_start();
	?>
	<a class="nd-gal-card" href="<?php echo esc_url( home_url( '/themes/' ) ); ?>">
		<img src="<?php echo esc_url( ndw_gallery_img( $first, true ) ); ?>" width="560" height="350" alt="">
		<span><b>Theme gallery</b><span class="nd-muted"><?php echo esc_html( sprintf( '%d dashboards: every material in dark and light, the twelve looks, surfaces and backdrops. Search for a theme by name.', count( $data['shots'] ) ) ); ?></span><span class="nd-gal-card-go">Browse the gallery →</span></span>
	</a>
	<?php
	return (string) ob_get_clean();
}

/** Theme names in the gallery, for the header search. */
function ndw_gallery_theme_names() {
	$data = ndw_gallery_data();
	if ( ! $data ) {
		return array();
	}
	$names = array();
	foreach ( $data['shots'] as $s ) {
		if ( 'theme' === $s['kind'] ) {
			$names[ $s['name'] ] = true;
		}
	}
	return array_keys( $names );
}
