<?php
/**
 * Search results: the site's own pages and posts here; the docs are searched
 * from the box in the header, which shows both.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();
?>
<div class="nd-wrap nd-narrow">
	<header class="nd-page-head">
		<h1>Search: <?php echo esc_html( get_search_query() ); ?></h1>
		<p class="nd-lead">Pages and posts on nextdash.cc. For the manual, <a href="<?php echo esc_url( home_url( '/docs/' ) ); ?>">search the docs</a>.</p>
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
		<?php the_posts_pagination( array( 'prev_text' => '← Previous', 'next_text' => 'Next →' ) ); ?>
	<?php else : ?>
		<p class="nd-muted">Nothing found on the site for this search.</p>
	<?php endif; ?>
</div>
<?php
get_footer();
