<?php
/**
 * One post in a list: date, title, excerpt and its categories.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
$cats = get_the_category();
?>
<article <?php post_class( 'nd-row' ); ?>>
	<p class="nd-row-meta">
		<time datetime="<?php echo esc_attr( get_the_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_date( 'j F Y' ) ); ?></time>
		<?php if ( $cats ) : ?>
			<span>·</span>
			<?php foreach ( $cats as $i => $cat ) : ?>
				<a href="<?php echo esc_url( get_category_link( $cat ) ); ?>"><?php echo esc_html( $cat->name ); ?></a><?php echo $i < count( $cats ) - 1 ? ', ' : ''; ?>
			<?php endforeach; ?>
		<?php endif; ?>
		<span>·</span> <?php echo esc_html( ndw_reading_time() ); ?>
	</p>
	<h2 class="nd-row-title"><a href="<?php the_permalink(); ?>"><?php the_title(); ?></a></h2>
	<p class="nd-row-excerpt"><?php echo esc_html( wp_strip_all_tags( get_the_excerpt() ) ); ?></p>
</article>
