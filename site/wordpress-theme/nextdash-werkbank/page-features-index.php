<?php
/**
 * Template Name: Features overview
 *
 * Every feature page, in its group: a title and one sentence each.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

$labels = ndw_feature_group_labels();
?>
<div class="nd-wrap">
	<header class="nd-page-head nd-narrow">
		<h1><?php the_title(); ?></h1>
		<?php
		// The page's own text is the introduction; a fixed one only when it has none.
		$intro = trim( wp_strip_all_tags( (string) get_post_field( 'post_content', get_queried_object_id() ) ) );
		?>
		<p class="nd-lead"><?php echo esc_html( $intro ? $intro : 'What nextDash does, one page per feature. Each page links to the docs chapter with every detail.' ); ?></p>
	</header>
	<?php echo ndw_gallery_card(); // phpcs:ignore WordPress.Security.EscapeOutput ?>
	<?php foreach ( ndw_feature_groups() as $slug => $pages ) : ?>
		<section class="nd-group nd-reveal">
			<h2 class="nd-label"><?php echo esc_html( $labels[ $slug ] ); ?></h2>
			<div class="nd-mcards">
				<?php
				// Each card shows the feature's picture and plays its recording on hover.
				foreach ( $pages as $p ) {
					$title = $p['title'] . ( 'draft' === $p['status'] ? ' (draft)' : '' );
					echo ndw_motion_card( $p['video'] ? $p['video'] : $p['slug'], $title, esc_html( $p['blurb'] ), $p['url'], '', $p['thumb'] ); // phpcs:ignore WordPress.Security.EscapeOutput
				}
				?>
			</div>
		</section>
	<?php endforeach; ?>
</div>
<?php
get_footer();
