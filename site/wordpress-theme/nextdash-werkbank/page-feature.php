<?php
/**
 * Template Name: Feature
 *
 * One feature: what it does, its picture or recording, its keys, the
 * explanation, and a link to the docs chapter that goes into detail.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

while ( have_posts() ) :
	the_post();
	$id      = get_the_ID();
	$blurb   = (string) get_post_meta( $id, 'ndt_feature_blurb', true );
	$video   = (string) get_post_meta( $id, 'ndt_feature_video', true );
	$keys    = ndw_feature_parse_keys( get_post_meta( $id, 'ndt_feature_keys', true ) );
	$related = array_filter( array_map( 'trim', explode( ',', (string) get_post_meta( $id, 'ndt_feature_related', true ) ) ) );
	$poster  = $video ? ndw_feature_img_url( $video . '/poster.jpg' ) : '';
	$loop    = $video ? ndw_feature_img_url( $video . '/loop.webm' ) : '';
	?>
	<article <?php post_class( 'nd-wrap nd-narrow nd-article nd-feature' ); ?>>
		<header class="nd-page-head">
			<p class="nd-crumb"><a href="<?php echo esc_url( home_url( '/features/' ) ); ?>">Features</a></p>
			<h1><?php the_title(); ?></h1>
			<?php if ( $blurb ) : ?><p class="nd-lead"><?php echo esc_html( $blurb ); ?></p><?php endif; ?>
		</header>

		<?php if ( $loop ) : ?>
			<figure class="nd-loop">
				<video muted loop playsinline preload="metadata" <?php echo $poster ? 'poster="' . esc_url( $poster ) . '"' : ''; ?> aria-label="<?php echo esc_attr( sprintf( 'Short screen recording: %s', get_the_title() ) ); ?>" data-nd-loop>
					<source src="<?php echo esc_url( $loop ); ?>" type="video/webm">
				</video>
				<button type="button" class="nd-loop-btn" data-nd-loop-toggle>Pause</button>
			</figure>
		<?php endif; ?>

		<?php if ( $keys ) : ?>
			<ul class="nd-keys" aria-label="Keyboard shortcuts">
				<?php foreach ( $keys as $k ) : ?>
					<li>
						<span class="nd-keys-combo"><?php foreach ( $k['keys'] as $key ) : ?><kbd><?php echo esc_html( $key ); ?></kbd><?php endforeach; ?></span>
						<span><?php echo esc_html( $k['label'] ); ?></span>
					</li>
				<?php endforeach; ?>
			</ul>
		<?php endif; ?>

		<div class="nd-content">
			<?php the_content(); ?>
		</div>

		<footer class="nd-article-foot">
			<p class="nd-docs-link"><a class="nd-btn" href="<?php echo esc_url( ndw_feature_docs_url( get_post_field( 'post_name' ) ) ); ?>">Read the docs →</a></p>
			<?php if ( $related ) : ?>
				<p class="nd-muted">See also:
					<?php
					$out = array();
					foreach ( $related as $slug ) {
						$rp = get_page_by_path( 'features/' . $slug );
						if ( $rp && ( 'publish' === $rp->post_status || current_user_can( 'edit_page', $rp->ID ) ) ) {
							$out[] = sprintf( '<a href="%s">%s</a>', esc_url( get_permalink( $rp ) ), esc_html( get_the_title( $rp ) ) );
						}
					}
					echo implode( ', ', $out ); // phpcs:ignore WordPress.Security.EscapeOutput
					?>
				</p>
			<?php endif; ?>
		</footer>
	</article>
	<?php
endwhile;

get_footer();
