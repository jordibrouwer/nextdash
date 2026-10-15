<?php
/**
 * One post. Comments are closed; GitHub Discussions is where the talk is.
 *
 * @package nextDash_Werkbank
 */

defined( 'ABSPATH' ) || exit;
get_header();

while ( have_posts() ) :
	the_post();
	$cats = get_the_category();
	?>
	<article <?php post_class( 'nd-wrap nd-narrow nd-article' ); ?>>
		<header class="nd-page-head">
			<p class="nd-crumb"><a href="<?php echo esc_url( home_url( '/news/' ) ); ?>">News</a><?php if ( $cats ) : ?> › <a href="<?php echo esc_url( get_category_link( $cats[0] ) ); ?>"><?php echo esc_html( $cats[0]->name ); ?></a><?php endif; ?></p>
			<h1><?php the_title(); ?></h1>
			<p class="nd-row-meta">
				<time datetime="<?php echo esc_attr( get_the_date( DATE_W3C ) ); ?>"><?php echo esc_html( get_the_date( 'j F Y' ) ); ?></time>
				<span>·</span> <?php echo esc_html( ndw_reading_time() ); ?>
			</p>
		</header>
		<div class="nd-content">
			<?php the_content(); ?>
		</div>
		<footer class="nd-article-foot">
			<?php the_tags( '<p class="nd-tags">', ' ', '</p>' ); ?>
			<p class="nd-muted">Questions or ideas about this post? <a href="<?php echo esc_url( ndw_links()['discussions'] ); ?>" rel="noopener">Talk about it on GitHub Discussions</a>.</p>
			<nav class="nd-prevnext" aria-label="More posts">
				<?php
				$prev = get_previous_post();
				$next = get_next_post();
				if ( $prev ) {
					printf( '<a class="nd-prev" href="%s"><small>Older</small>%s</a>', esc_url( get_permalink( $prev ) ), esc_html( get_the_title( $prev ) ) );
				}
				if ( $next ) {
					printf( '<a class="nd-next" href="%s"><small>Newer</small>%s</a>', esc_url( get_permalink( $next ) ), esc_html( get_the_title( $next ) ) );
				}
				?>
			</nav>
		</footer>
	</article>
	<?php
endwhile;

get_footer();
