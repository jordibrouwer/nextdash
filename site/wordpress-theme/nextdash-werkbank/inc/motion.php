<?php
/**
 * The moving parts of the homepage and Features, as markup: the hero's looks,
 * the figures, the terminal and the cards with a recording. assets/js/motion.js
 * makes them move.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;

/**
 * The looks the hero shows in turn, as label => gallery shot id. The first is
 * the theme's own dashboard picture.
 */
function ndw_hero_looks() {
	return apply_filters(
		'ndw_hero_looks',
		array(
			'Gloss Chrome' => '',
			'Slate'        => 'theme-slate-dark',
			'Paper Ink'    => 'theme-paper-ink-light',
			'Glass'        => 'look-glass-synth-sunset-dark',
			'Neon'         => 'look-neon-gloss-liquid-chrome-dark',
			'Frosted'      => 'look-frosted-slate-light',
		)
	);
}

/** The hero picture with its looks to choose from. */
function ndw_hero_shot() {
	$home  = get_template_directory_uri() . '/assets/img/home-dashboard.jpg?v=' . ndw_asset_version( 'assets/img/home-dashboard.jpg' );
	$looks = array();
	foreach ( ndw_hero_looks() as $label => $id ) {
		if ( '' === $id ) {
			$looks[ $label ] = $home;
		} elseif ( ndw_gallery_data() ) {
			$looks[ $label ] = ndw_gallery_img( $id );
		}
	}
	ob_start();
	?>
	<figure class="nd-hero-shot" data-nd-looks>
		<div class="nd-looks-shot">
			<?php $i = 0; foreach ( $looks as $label => $src ) : ?>
				<img src="<?php echo esc_url( $src ); ?>" width="1680" height="1050" alt="<?php echo esc_attr( sprintf( 'The nextDash dashboard in %s: a header with clock, weather and page switcher, then categories of bookmarks and widgets in three columns', $label ) ); ?>"<?php echo 0 === $i ? ' class="is-on" fetchpriority="high"' : ' loading="lazy"'; ?>>
			<?php $i++; endforeach; ?>
		</div>
		<?php if ( count( $looks ) > 1 ) : ?>
			<div class="nd-looks" role="group" aria-label="Try a look">
				<span class="nd-looks-label">Try a look:</span>
				<?php $i = 0; foreach ( array_keys( $looks ) as $label ) : ?>
					<button type="button" class="nd-look-chip" aria-pressed="<?php echo 0 === $i ? 'true' : 'false'; ?>"><?php echo esc_html( $label ); ?></button>
				<?php $i++; endforeach; ?>
				<?php if ( ndw_gallery_page() ) : ?><a class="nd-looks-more" href="<?php echo esc_url( home_url( '/themes/' ) ); ?>">All themes →</a><?php endif; ?>
			</div>
		<?php endif; ?>
	</figure>
	<?php
	return (string) ob_get_clean();
}

/**
 * The figures under the hero, as number => label. Checked against the code:
 * the theme families and backdrops in the server, the looks in the studio,
 * the Custom widget's presets, the widget register (knownWidgetTypes), the
 * two app lists of the tag suggestions and the locale files.
 */
function ndw_stats() {
	return apply_filters(
		'ndw_stats',
		array(
			array( 164, 'theme families, dark and light' ),
			array( 12, 'looks' ),
			array( 26, 'backdrops' ),
			array( 41, 'services for the Custom widget' ),
			array( 43, 'kinds of widget' ),
			array( 1905, 'self-hosted apps known by name' ),
			array( 6, 'languages' ),
		)
	);
}

/**
 * A card with a feature's poster that plays its recording on hover. $slug
 * names the feature's picture folder; $poster, when given, is the picture
 * shown instead of that folder's poster.
 */
function ndw_motion_card( $slug, $title, $text, $url, $more = '', $poster = '' ) {
	$poster = $poster ? $poster : ndw_feature_img_url( $slug . '/poster.jpg' );
	$loop   = ndw_feature_img_url( $slug . '/loop.webm' );
	ob_start();
	?>
	<a class="nd-mcard" href="<?php echo esc_url( $url ); ?>"<?php echo $loop ? ' data-loop="' . esc_url( $loop ) . '"' : ''; ?>>
		<?php if ( $poster ) : ?>
			<span class="nd-mcard-media">
				<img src="<?php echo esc_url( $poster ); ?>" width="1440" height="900" loading="lazy" decoding="async" alt="">
				<?php if ( $loop ) : ?><span class="nd-mcard-play" aria-hidden="true">▶ hover</span><?php endif; ?>
			</span>
		<?php endif; ?>
		<span class="nd-mcard-text">
			<b><?php echo esc_html( $title ); ?></b>
			<span><?php echo wp_kses( $text, array( 'kbd' => array() ) ); ?></span>
			<?php if ( $more ) : ?><span class="nd-mcard-more"><?php echo esc_html( $more ); ?></span><?php endif; ?>
		</span>
	</a>
	<?php
	return (string) ob_get_clean();
}
