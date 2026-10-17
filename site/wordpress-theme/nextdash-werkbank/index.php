<?php
/**
 * Lists of posts: News (the posts page), categories, tags, dates and authors.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

$releases = get_category_by_slug( 'releases' );
if ( is_home() ) {
	$title = 'News';
	$intro = 'Release notes and the development log of nextDash.';
} else {
	$title = get_the_archive_title();
	$intro = get_the_archive_description();
}
?>
<div class="nd-wrap nd-narrow">
	<header class="nd-page-head">
		<h1><?php echo esc_html( wp_strip_all_tags( $title ) ); ?></h1>
		<?php if ( $intro ) : ?><p class="nd-lead"><?php echo esc_html( wp_strip_all_tags( $intro ) ); ?></p><?php endif; ?>
		<?php if ( $releases && ( is_home() || is_category() ) ) : ?>
			<nav class="nd-chips" aria-label="Kind of post">
				<a href="<?php echo esc_url( home_url( '/news/' ) ); ?>"<?php echo is_home() ? ' aria-current="page"' : ''; ?>>All</a>
				<a href="<?php echo esc_url( get_category_link( $releases ) ); ?>"<?php echo is_category( 'releases' ) ? ' aria-current="page"' : ''; ?>>Releases</a>
			</nav>
		<?php endif; ?>
	</header>

	<?php if ( have_posts() ) : ?>
		<div class="nd-rows">
			<?php
			while ( have_posts() ) :
				the_post();
				get_template_part( 'template-parts/post-row' );
			endwhile;
			?>
		</div>
		<?php
		the_posts_pagination(
			array(
				'prev_text' => '← Newer',
				'next_text' => 'Older →',
				'mid_size'  => 1,
			)
		);
		?>
	<?php else : ?>
		<p class="nd-muted">Nothing here yet.</p>
	<?php endif; ?>
</div>
<?php
get_footer();
