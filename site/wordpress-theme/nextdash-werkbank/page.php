<?php
/**
 * A plain page.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

while ( have_posts() ) :
	the_post();
	?>
	<article <?php post_class( 'nd-wrap nd-narrow nd-article' ); ?>>
		<header class="nd-page-head">
			<h1><?php the_title(); ?></h1>
		</header>
		<div class="nd-content">
			<?php the_content(); ?>
		</div>
	</article>
	<?php
endwhile;

get_footer();
